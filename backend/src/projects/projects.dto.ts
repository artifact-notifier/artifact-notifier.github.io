import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Ecosystem } from '@prisma/client';

// Same alphabet as FollowDto: npm names, Maven group:artifact, PyPI names
const COORDINATES = /^[\w.@/:-]+$/;
export const DEP_SCOPES = ['prod', 'dev', 'optional', 'peer', 'test', 'provided', 'plugin', 'parent', 'bom'] as const;
const IMPORTABLE = [Ecosystem.NPM, Ecosystem.MAVEN, Ecosystem.PYPI];

export class DependencyDto {
  @IsString()
  @MaxLength(256)
  @Matches(COORDINATES)
  coordinates!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  declared?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  version?: string;

  @IsIn(DEP_SCOPES)
  scope!: (typeof DEP_SCOPES)[number];
}

export class SourceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @IsString()
  @MaxLength(64)
  kind!: string;

  @IsIn(IMPORTABLE)
  ecosystem!: Ecosystem;

  @ValidateNested({ each: true })
  @Type(() => DependencyDto)
  @ArrayMaxSize(2000)
  dependencies!: DependencyDto[];
}

export class FollowRefDto {
  @IsIn(IMPORTABLE)
  ecosystem!: Ecosystem;

  @IsString()
  @MaxLength(256)
  @Matches(COORDINATES)
  coordinates!: string;
}

/** Creates the project (projectName) or updates one (projectId); sources are replaced by label. */
export class ImportDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  projectName?: string;

  @ValidateNested({ each: true })
  @Type(() => SourceDto)
  @ArrayMaxSize(50)
  sources!: SourceDto[];

  @ValidateNested({ each: true })
  @Type(() => FollowRefDto)
  @ArrayMaxSize(500)
  follow!: FollowRefDto[];
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  notifyNewerOnly?: boolean;
}
