import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthedUser, CurrentUser } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ImportDto, UpdateProjectDto } from './projects.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: AuthedUser) {
    return this.projects.list(user.sub);
  }

  @Post('import')
  import(@CurrentUser() user: AuthedUser, @Body() dto: ImportDto) {
    return this.projects.import(user.sub, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(user.sub, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.projects.remove(user.sub, id);
  }

  @Delete(':id/sources/:sourceId')
  removeSource(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Param('sourceId') sourceId: string) {
    return this.projects.removeSource(user.sub, id, sourceId);
  }
}
