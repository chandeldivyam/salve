import { buildEnvelope, type PriorMessage } from '../../email/envelope.js';
import { sendRawEmail } from '../../email/mailer.js';

export interface EmailDriverContext {
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  ticket: {
    id: string;
    shortID: number;
    title: string;
  };
  message: {
    id: string;
    bodyHtml: string;
    bodyText: string;
  };
  customer: {
    id: string;
    email: string;
    name?: string | null;
    displayName?: string | null;
  };
  emailAddress: {
    id: string;
    localPart: string;
    fullAddress: string;
  };
  emailChannel: {
    fromName?: string | null;
    signature?: string | null;
  };
  sendingDomain: {
    id: string;
    domain: string;
    mailFromSubdomain?: string | null;
  };
  priorMessages: PriorMessage[];
}

export interface EmailDriverResult {
  providerMessageID: string;
  providerMeta: Record<string, unknown>;
}

export async function sendEmailMessage(ctx: EmailDriverContext): Promise<EmailDriverResult> {
  const envelope = buildEnvelope({
    workspace: ctx.workspace,
    ticket: ctx.ticket,
    message: ctx.message,
    customer: ctx.customer,
    sendingDomain: {
      domain: ctx.sendingDomain.domain,
      sendingLocalpart: ctx.emailAddress.localPart,
      fullAddress: ctx.emailAddress.fullAddress,
    },
    emailChannel: {
      fromName: ctx.emailChannel.fromName,
      signature: ctx.emailChannel.signature,
    },
    priorMessages: ctx.priorMessages,
    unsubscribeToken: `${ctx.workspace.id}.${ctx.customer.id}`,
  });

  const result = await sendRawEmail(envelope);

  return {
    providerMessageID: result.providerMessageID,
    providerMeta: {
      backend: result.backend,
      rfcMessageID: envelope.rfcMessageID,
      from: envelope.from,
      to: envelope.to,
      replyTo: envelope.replyTo,
      subject: envelope.subject,
      emailAddressID: ctx.emailAddress.id,
      sendingDomainID: ctx.sendingDomain.id,
    },
  };
}
