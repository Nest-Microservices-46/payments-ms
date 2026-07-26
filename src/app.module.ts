import { Module } from '@nestjs/common';
import { PaymentsModule } from './payments/payments.module';
import { FakeStripeModule } from './fake-stripe/fake-stripe.module';

@Module({
  imports: [PaymentsModule, FakeStripeModule],
  controllers: [],
  providers: [],
})
export class AppModule { }
