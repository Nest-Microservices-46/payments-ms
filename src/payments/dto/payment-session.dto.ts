import { ArrayMinSize, IsArray, IsNumber, IsString } from 'class-validator';

export class PaymentSessionItemDto {
  @IsString()
  name: string;

  @IsNumber()
  price: number; // en unidades (15.5), no en centavos

  @IsNumber()
  quantity: number;
}

export interface PaymentSessionDto {
  orderId: string;
  currency: string;
  items: PaymentSessionItemDto[];
}
