/**
 * Public satisfaction rating, from the link in a resolution email.
 *
 * No session, by design: the people whose opinion the desk most needs are the
 * ones with no account — a supplier, a customer, an employee who has never
 * opened the portal. The per-ticket bearer token in the URL is the whole
 * authority, so it names one ticket and grants nothing else.
 *
 * The GET never writes. Mail providers follow links in messages to scan them,
 * and a score recorded by a scanner is worse than no score at all: it cannot be
 * told apart from a real one. So the link chooses a rating and the person
 * confirms it.
 */
const express = require('express');

const router = express.Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { ticketService, settingsService } = require('../services');
const { renderCsatPage } = require('../utils/csatPage');

async function chrome() {
  try {
    const s = await settingsService.getSettings();
    return { lang: s.language || 'en', company: s.companyName || 'ITACM' };
  } catch { return { lang: 'en', company: 'ITACM' }; }
}

router.get('/:token', asyncHandler(async (req, res) => {
  const { lang, company } = await chrome();
  const picked = Math.round(Number(req.query.r));
  let ticket = null;
  try { ticket = await ticketService.getByCsatToken(req.params.token); } catch { /* rendered as gone */ }
  const notResolved = ticket && !['resolved', 'closed'].includes(ticket.status);
  res.status(ticket ? 200 : 404).type('html').send(renderCsatPage({
    ticket, token: req.params.token, lang, company, nonce: res.locals.cspNonce,
    picked: picked >= 1 && picked <= 5 ? picked : 0,
    error: !ticket ? 'gone' : (notResolved ? 'not_resolved' : ''),
  }));
}));

router.post('/:token', express.urlencoded({ extended: false, limit: '32kb' }), asyncHandler(async (req, res) => {
  const { lang, company } = await chrome();
  const body = req.body || {};
  try {
    const out = await ticketService.submitCsatByToken(req.params.token, {
      rating: body.rating, comment: body.comment,
    });
    return res.type('html').send(renderCsatPage({
      ticket: { number: out.number }, picked: out.rating, done: true, lang, company,
      nonce: res.locals.cspNonce,
    }));
  } catch (err) {
    let ticket = null;
    try { ticket = await ticketService.getByCsatToken(req.params.token); } catch { /* gone */ }
    // Only a deliberate 4xx explains itself. Anything else — a database that is
    // down, a bug — is shown as a plain refusal: this page is served to the
    // public, and an internal message is a free look inside.
    const shown = err && err.status && err.status < 500 ? err.message : 'Something went wrong. Please try the link again.';
    return res.status(ticket ? (err.status || 400) : 404).type('html').send(renderCsatPage({
      ticket, token: req.params.token, lang, company, nonce: res.locals.cspNonce,
      error: ticket ? shown : 'gone',
    }));
  }
}));

module.exports = router;
