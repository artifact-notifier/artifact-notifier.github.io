import { Controller, Get } from '@nestjs/common';
import { ArtifactsService } from './artifacts.service';

/** No session: shown on the login page. Counts only, never which artifacts are followed. */
@Controller('public')
export class PublicController {
  constructor(private readonly artifacts: ArtifactsService) {}

  @Get('stats')
  stats() {
    return this.artifacts.getPublicStats();
  }
}
