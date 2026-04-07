import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  input: string;
}
