import { Module } from '@nestjs/common';
import { FakeStripeController } from './fake-stripe.controller';
import { FakeStripeService } from './fake-stripe.service';

@Module({
  controllers: [FakeStripeController],
  providers: [FakeStripeService],
})
export class FakeStripeModule {}
