// SES inbound bridge: SNS event → re-POST to /api/inbound/email/ses with
// the shared webhook secret as a header. Exists because SNS HTTPS
// subscriptions can't inject custom headers, but the API handler trusts
// requests via `x-salve-webhook-secret`.
//
// Wired up via SNS lambda subscription on the SesInboundTopic — see
// infra/components/ses-inbound.ts.

import type { SNSEvent } from 'aws-lambda';

const ENDPOINT = process.env.INBOUND_ENDPOINT;
const SECRET = process.env.SES_INBOUND_WEBHOOK_SECRET;

export const handler = async (event: SNSEvent): Promise<void> => {
  if (!ENDPOINT || !SECRET) {
    console.error('Missing INBOUND_ENDPOINT or SES_INBOUND_WEBHOOK_SECRET env');
    throw new Error('config-missing');
  }

  for (const record of event.Records) {
    const sns = record.Sns;
    // SNS Message field carries the SES notification JSON as a string.
    // The API handler accepts both raw notifications and SNS-wrapped bodies,
    // but we forward just the inner Message so the handler doesn't need to
    // re-unwrap.
    const body = sns.Message;
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-salve-webhook-secret': SECRET,
          'x-sns-message-id': sns.MessageId,
          'x-sns-topic-arn': sns.TopicArn,
        },
        body,
      });
    } catch (err) {
      console.error('Forward fetch failed', { messageId: sns.MessageId, err });
      throw err;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('Forward non-2xx', {
        messageId: sns.MessageId,
        status: res.status,
        body: text.slice(0, 500),
      });
      // Throwing makes Lambda mark the SNS delivery as failed, so SNS retries
      // (Standard SNS retries up to 3× with backoff).
      throw new Error(`forward-failed-${res.status}`);
    }
    console.log('Forwarded', { messageId: sns.MessageId, status: res.status });
  }
};
