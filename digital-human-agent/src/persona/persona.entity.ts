import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('persona')
export class Persona {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'speaking_style', nullable: true })
  speakingStyle: string;

  @Column({ type: 'jsonb', default: [] })
  expertise: string[];

  @Column({ name: 'voice_id', nullable: true })
  voiceId: string;

  @Column({ name: 'avatar_id', nullable: true })
  avatarId: string;

  @Column({ name: 'system_prompt_extra', nullable: true })
  systemPromptExtra: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
