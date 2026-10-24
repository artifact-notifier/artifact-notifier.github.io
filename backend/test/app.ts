import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MavenArtifactListener } from '../src/listeners/maven-artifact.listener';
import { NpmArtifactListener } from '../src/listeners/npm-artifact.listener';
import { PypiArtifactListener } from '../src/listeners/pypi-artifact.listener';

/** Whole application over HTTP, without the registry listeners (no network). */
export async function createTestApp(): Promise<INestApplication> {
  const noListener = { refreshFollowed: async () => undefined };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(NpmArtifactListener)
    .useValue(noListener)
    .overrideProvider(MavenArtifactListener)
    .useValue(noListener)
    .overrideProvider(PypiArtifactListener)
    .useValue(noListener)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

export function bearer(app: INestApplication, user: { id: string; email: string }) {
  const token = app
    .get(JwtService)
    .sign({ sub: user.id, email: user.email, provider: 'test' }, { secret: 'test-secret' });
  return { Authorization: `Bearer ${token}` };
}
