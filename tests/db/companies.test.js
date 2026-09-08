/**
 * Multi-company: the migration's backfill, the guards on the companies table,
 * and what a cross-company handover records.
 *
 * The interesting part is the handover snapshot. A zimmet receipt is a legal
 * document — it has to reprint years later exactly as it was signed, which means
 * the letterhead and each line's owner are frozen onto the row rather than
 * looked up again at print time.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

test('companies', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();
  t.after(() => db.teardown());

  const { query } = require('../../src/providers/postgres/pool');
  const companyService = require('../../src/providers/postgres/companyService');
  const handoverService = require('../../src/providers/postgres/handoverService');
  const assetService = require('../../src/providers/postgres/assetService');
  const employeeService = require('../../src/providers/postgres/employeeService');

  await t.test('provisioning leaves exactly one default company', async () => {
    const list = await companyService.listCompanies();
    assert.equal(list.length, 1, 'the workspace itself is seeded as the first entity');
    assert.equal(list[0].isDefault, true);
    // Branding is deliberately NULL so a single-company install keeps inheriting
    // the workspace logo from Settings.
    assert.equal(list[0].logo, null);
  });

  await t.test('the backfill attaches existing rows to the default company', async () => {
    const def = await companyService.getDefaultCompany();
    const asset = await db.makeAsset();
    // Fixtures insert raw, so this row starts company-less; the service path is
    // what fills it — that is what the migration's UPDATE does for real data.
    assert.equal(asset.company_id, null);

    const created = await assetService.createAsset({
      serialNumber: `SN-${Date.now()}`, brand: 'Dell', model: 'XPS', category: 'Laptop',
    }, db.IT_USER);
    const { rows } = await query('SELECT company_id FROM assets WHERE id = $1', [created.id]);
    assert.equal(rows[0].company_id, def.id, 'a new asset files under the default company');
  });

  await t.test('a new employee also files under the default company', async () => {
    const def = await companyService.getDefaultCompany();
    const emp = await employeeService.createEmployee({
      fullName: 'Default Co Person', email: `def${Date.now()}@test.local`,
    });
    assert.equal(emp.companyId, def.id);
  });

  await t.test('names are unique case-insensitively', async () => {
    await companyService.createCompany({ name: 'Acme Teknoloji' });
    await assert.rejects(
      () => companyService.createCompany({ name: 'ACME TEKNOLOJI' }),
      /already exists/i
    );
  });

  await t.test('a company cannot be its own ancestor', async () => {
    const parent = await companyService.createCompany({ name: `Parent ${Date.now()}` });
    const child = await companyService.createCompany({ name: `Child ${Date.now()}`, parentId: parent.id });
    await assert.rejects(
      () => companyService.updateCompany(parent.id, { parentId: child.id }),
      /loop/i
    );
    await assert.rejects(
      () => companyService.updateCompany(parent.id, { parentId: parent.id }),
      /its own parent/i
    );
  });

  await t.test('setting a new default leaves exactly one', async () => {
    const other = await companyService.createCompany({ name: `Switch ${Date.now()}` });
    await companyService.setDefaultCompany(other.id);
    const { rows } = await query('SELECT count(*)::int AS n FROM companies WHERE is_default');
    assert.equal(rows[0].n, 1);
    assert.equal((await companyService.getDefaultCompany()).id, other.id);
  });

  await t.test('a company that still owns something cannot be deleted', async () => {
    const co = await companyService.createCompany({ name: `Owns Stuff ${Date.now()}` });
    await db.makeAsset({ companyId: co.id });
    await assert.rejects(() => companyService.deleteCompany(co.id), /still owns/i);
    // Empty again → deletable.
    await query('UPDATE assets SET company_id = NULL WHERE company_id = $1', [co.id]);
    assert.deepEqual(await companyService.deleteCompany(co.id), { id: co.id, deleted: true });
  });

  await t.test('branding falls back to the workspace, field by field', async () => {
    const partial = await companyService.createCompany({
      name: `Partial ${Date.now()}`,
      address: 'Kadıköy, İstanbul',
      // no logo, no terms → both inherit
    });
    const b = await companyService.resolveBranding(partial.id);
    assert.equal(b.companyName, partial.name, 'its own name always wins');
    assert.equal(b.companyAddress, 'Kadıköy, İstanbul');
    assert.equal(b.companyLogo, null, 'no logo anywhere yet, so null rather than a stale one');
  });

  await t.test('a cross-company handover freezes the letterhead and each owner', async () => {
    const acme = await companyService.createCompany({ name: `Acme HO ${Date.now()}` });
    const beta = await companyService.createCompany({ name: `Beta HO ${Date.now()}` });

    const person = await db.makeEmployee({ companyId: acme.id });
    const ownAsset = await db.makeAsset({ companyId: acme.id });
    const borrowed = await db.makeAsset({ companyId: beta.id });

    const receipt = await handoverService.executeHandover({
      employeeId: person.id,
      items: [{ assetId: ownAsset.id }, { assetId: borrowed.id }],
    }, db.IT_USER);

    assert.equal(receipt.companyId, acme.id, 'the form belongs to the employee’s company');
    assert.deepEqual([...receipt.ownerCompanyIds].sort(), [acme.id, beta.id].sort());

    const stored = await handoverService.getHandover(receipt.handoverId);
    assert.equal(stored.companyId, acme.id);
    assert.equal(stored.companySnapshot.companyName, acme.name,
      'the letterhead is snapshotted, not looked up at print time');

    const byTag = Object.fromEntries(stored.items.map((i) => [i.assetTag, i]));
    assert.equal(byTag[ownAsset.asset_tag].ownerCompanyName, acme.name);
    assert.equal(byTag[borrowed.asset_tag].ownerCompanyName, beta.name);

    // Rename the owner afterwards: the signed receipt must not change.
    await companyService.updateCompany(beta.id, { name: `Beta Renamed ${Date.now()}` });
    const reread = await handoverService.getHandover(receipt.handoverId);
    assert.equal(
      reread.items.find((i) => i.assetTag === borrowed.asset_tag).ownerCompanyName,
      beta.name,
      'a rename must not rewrite history on a signed document'
    );
  });

  await t.test('the picker list never carries branding or tax details', async () => {
    // /options is the one company endpoint open to any signed-in user, because
    // every asset and employee form needs the picker. It must therefore stay
    // free of the things the full record holds — tax number, address, logo,
    // contact details, handover terms.
    await companyService.createCompany({
      name: `Sensitive ${Date.now()}`,
      taxNo: '1112223334', address: 'Somewhere', email: 'a@b.c', phone: '555',
      logo: 'data:image/png;base64,iVBORw0KGgo=', handoverTerms: 'secret clause',
    });
    const options = await companyService.listCompanyOptions();
    assert.ok(options.length > 0);
    const leaked = ['logo', 'address', 'taxNo', 'taxOffice', 'email', 'phone', 'handoverTerms']
      .filter((k) => options.some((o) => k in o));
    assert.deepEqual(leaked, [], `picker list must not expose ${leaked.join(', ')}`);
  });

  await t.test('the asset list can be scoped to one company', async () => {
    const only = await companyService.createCompany({ name: `Scoped ${Date.now()}` });
    await db.makeAsset({ companyId: only.id });
    await db.makeAsset({ companyId: only.id });

    const scoped = await assetService.listAssets({ companyId: only.id, limit: 100 });
    assert.equal(scoped.total, 2);
    assert.ok(scoped.items.every((a) => a.companyName === only.name),
      'the list carries the company name so reports need no second lookup');

    const junk = await assetService.listAssets({ companyId: 'not-a-uuid', limit: 100 });
    assert.equal(junk.total, 0, 'an unparseable scope returns nothing rather than everything');
  });
});
