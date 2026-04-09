import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Persona } from './persona.entity';
import { CreatePersonaDto } from './dto/create-persona.dto';
import { UpdatePersonaDto } from './dto/update-persona.dto';

@Injectable()
export class PersonaService {
  constructor(
    @InjectRepository(Persona)
    private readonly repo: Repository<Persona>,
  ) {}

  create(dto: CreatePersonaDto): Promise<Persona> {
    const persona = this.repo.create(dto);
    return this.repo.save(persona);
  }

  findAll(): Promise<Persona[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Persona> {
    const persona = await this.repo.findOneBy({ id });
    if (!persona) throw new NotFoundException(`Persona ${id} not found`);
    return persona;
  }

  async update(id: string, dto: UpdatePersonaDto): Promise<Persona> {
    await this.findOne(id);
    await this.repo.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repo.delete(id);
  }
}
