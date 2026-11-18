import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import {
  AuthPayload,
  CurrentUser,
} from '../../../../common/decorators/current-user.decorator';
import { Public } from '../../../../common/decorators/public.decorator';
import { EnvironmentVariables } from '../../../../context/config/app.config';
import { LoginDto } from '../dtos/login.dto';
import { TokenIssuerService } from '../../application/services/token-issuer.service';

const REFRESH_COOKIE_NAME = 'refreshToken';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly tokenIssuer: TokenIssuerService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  private setRefreshCookie(res: Response, token: string, maxAgeMs: number): void {
    const isProduction =
      this.configService.get('NODE_ENV', { infer: true }) === 'production';

    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/auth',
      maxAge: maxAgeMs,
    });
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autenticar usuario y emitir Access Token + httpOnly Refresh Cookie' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.tokenIssuer.login(dto.email, dto.password, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.setRefreshCookie(res, result.refreshToken, result.refreshMaxAgeMs);

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: {
        ...result.user,
        name: result.user.fullName,
        roles: [result.user.role],
      },
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotar Refresh Token desde cookie httpOnly o body y emitir nuevo Access Token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const bodyToken = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    const rawRefreshToken =
      (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined) || bodyToken;
    if (!rawRefreshToken) {
      throw new UnauthorizedException('No se encontró refreshToken.');
    }

    const result = await this.tokenIssuer.rotateRefreshToken(rawRefreshToken, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.setRefreshCookie(res, result.refreshToken, result.refreshMaxAgeMs);

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: {
        ...result.user,
        name: result.user.fullName,
        roles: [result.user.role],
      },
    };
  }

  @Get('me')
  @ApiOperation({ summary: 'Obtener perfil del usuario autenticado (Contrato Front Universal)' })
  async getMe(@CurrentUser() payload: AuthPayload) {
    if (!payload?.sub) {
      throw new UnauthorizedException('Sesión inválida.');
    }
    const user = await this.tokenIssuer.getUserProfile(payload.sub);
    return { user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revocar Refresh Token activo y limpiar cookie httpOnly' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    await this.tokenIssuer.revokeRefreshToken(rawRefreshToken);

    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      path: '/auth',
    });

    return { message: 'Sesión cerrada exitosamente.' };
  }
}
