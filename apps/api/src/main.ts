import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Restrict cross-origin requests to the known web app origin; the Next.js
  // Server Components/Actions boundary does not need CORS (server-to-server),
  // but future client-side and mobile consumers will.
  app.enableCors({
    origin: configService.get<string>('WEB_APP_URL') ?? 'http://localhost:3000',
  });

  const port = configService.get<string>('PORT') ?? '3001';
  await app.listen(port);
}
await bootstrap();
