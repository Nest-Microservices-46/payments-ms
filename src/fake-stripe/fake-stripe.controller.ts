import { Body, Controller, Get, Header, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { FakeStripeService } from './fake-stripe.service';
import type { CreateSessionDto } from './fake-stripe.types';
import { checkoutPage } from './checkout.template';

/** Las rutas que expondría Stripe. `payments-ms` sólo las consume por HTTP. */
@Controller('v1/checkout')
export class FakeStripeController {
  constructor(private readonly fakeStripeService: FakeStripeService) {}

  @Post('sessions')
  createSession(@Body() body: CreateSessionDto) {
    return this.fakeStripeService.createSession(body);
  }

  @Get('pay/:id')
  @Header('Content-Type', 'text/html')
  pay(@Param('id') id: string) {
    return checkoutPage(this.fakeStripeService.findSession(id));
  }

  @Post('pay/:id/confirm')
  async confirm(
    @Param('id') id: string,
    @Body('action') action: string,
    @Res() res: Response,
  ) {
    const url = await this.fakeStripeService.confirm(id, action);
    res.redirect(303, url);
  }
}
