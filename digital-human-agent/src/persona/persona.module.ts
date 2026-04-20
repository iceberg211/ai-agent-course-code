import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Persona } from '@/persona/persona.entity';
import { PersonaService } from '@/persona/persona.service';
import { PersonaController } from '@/persona/persona.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Persona])],
  providers: [PersonaService],
  controllers: [PersonaController],
  exports: [PersonaService],
})
export class PersonaModule {}
