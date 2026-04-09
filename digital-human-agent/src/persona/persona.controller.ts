import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PersonaService } from './persona.service';
import { CreatePersonaDto } from './dto/create-persona.dto';
import { UpdatePersonaDto } from './dto/update-persona.dto';

@ApiTags('personas')
@Controller('personas')
export class PersonaController {
  constructor(private readonly service: PersonaService) {}

  @Post()
  create(@Body() dto: CreatePersonaDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePersonaDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除角色' })
  @ApiParam({ name: 'id', description: '角色 ID（UUID）' })
  @ApiResponse({
    status: 200,
    description: '删除成功',
    schema: {
      example: { id: '2f5cbe22-29ee-4cd8-9157-07ad0b029c34', deleted: true },
    },
  })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
