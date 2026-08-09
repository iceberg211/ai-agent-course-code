import { PartialType } from '@nestjs/mapped-types';
import { CreatePersonaDto } from '@/persona/dto/create-persona.dto';

export class UpdatePersonaDto extends PartialType(CreatePersonaDto) {}
