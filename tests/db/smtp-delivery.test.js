/**
 * Does mail actually leave the building?
 *
 * Every other mail test in this suite fakes the transport, which is right for
 * testing our own logic and useless for testing the library under it. When
 * nodemailer went from 9 to 10 those tests all stayed green while proving
 * nothing about whether a message still reaches an SMTP server.
 *
 * So this one speaks real SMTP: a throwaway server on a loopback port, the
 * settings saved the way the Integrations screen saves them, and the app's own
 * sendTestEmail — then the delivered bytes are read back.
 *
 * Run: npm run test:db
 */
const net = require('node:net');
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

/** The smallest SMTP server that can accept one message. */
function smtpSink() {
  const received = [];
  const server = net.createServer((sock) => {
    let data = false;
    let body = '';
    sock.write('220 sink ESMTP\r\n');
    sock.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (data) {
        body += text;
        if (body.includes('\r\n.\r\n')) {
          data = false;
          received.push(body.slice(0, body.indexOf('\r\n.\r\n')));
          body = '';
          sock.write('250 OK queued\r\n');
        }
        return;
      }
      for (const line of text.split('\r\n').filter(Boolean)) {
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-sink\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (cmd === 'AUTH') sock.write('235 accepted\r\n');
        else if (cmd === 'MAIL' || cmd === 'RCPT') sock.write('250 OK\r\n');
        else if (cmd === 'DATA') { data = true; sock.write('354 go ahead\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return { server, received };
}

test('smtp delivery', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();

  const { server, received } = smtpSink();
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  // The SSRF guard refuses loopback unless the operator opted in — which is
  // exactly what an operator testing against a local relay would do.
  const priorAllow = process.env.SMTP_ALLOW_PRIVATE;
  process.env.SMTP_ALLOW_PRIVATE = '1';
  t.after(() => {
    if (priorAllow === undefined) delete process.env.SMTP_ALLOW_PRIVATE;
    else process.env.SMTP_ALLOW_PRIVATE = priorAllow;
    return new Promise((r) => server.close(r)).then(() => db.teardown());
  });

  const svc = require('../../src/providers/postgres/notificationService');
  await svc.saveMailConfig({
    smtp: { host: '127.0.0.1', port, secure: false, user: 'desk', pass: 'secret', from: 'desk@itacm.test' },
    notify: { enabled: true, to: ['ops@itacm.test'] },
  });

  await t.test('a test message reaches a real SMTP server', async () => {
    const res = await svc.sendTestEmail('ops@itacm.test');
    assert.deepEqual(res, { sent: true, to: ['ops@itacm.test'] }, 'the service reports the send it made');
    assert.equal(received.length, 1, 'and exactly one message actually reached the server');
  });

  await t.test('the delivered message is a real MIME mail, not a fragment', async () => {
    const raw = received[0];
    assert.match(raw, /^From: .*desk@itacm\.test/m, 'the From the operator saved');
    assert.match(raw, /^To: .*ops@itacm\.test/m);
    assert.match(raw, /^Subject: /m);
    assert.match(raw, /^MIME-Version: 1\.0/m);
    assert.match(raw, /Content-Type: multipart\/alternative/i, 'html + text alternatives');
    assert.match(raw, /^Message-ID: </m);
  });
});
