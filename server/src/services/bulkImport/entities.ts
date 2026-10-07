/**
 * Bulk-importable master data. Each definition mirrors the validation of the matching REST route
 * (routes/org.ts, routes/masterdata.ts, routes/users.ts, routes/company.ts) so an Excel import can never
 * create data the screens could not.
 */
import { COMPANY_ROLES, type BulkImportKind, type Lang } from '@finbridge/shared';
import { all, get, run } from '../../db/database';
import { hashPassword } from '../../auth/password';
import { nowIso } from '../../lib/clock';
import { badRequest, conflict } from '../../lib/errors';
import { assertSeatAvailable } from '../../lib/license';
import { AccountIndex } from '../accounts';
import { allowedParentsMap, OrgIndex } from '../org';
import { bool, clearable, CLEAR, inDependencyOrder, setField, str, userIdByEmail, type Ctx, type EntityDef, type Row } from './engine';

const YES = (v: number | boolean, lang?: Lang) => (v ? (lang === 'en' ? 'Yes' : 'Bəli') : (lang === 'en' ? 'No' : 'Xeyr'));
const ACTIVE = { key: 'active', az: 'Aktiv', en: 'Active', type: 'bool' as const, hintAz: 'Xeyr — qeyd deaktiv edilir (silinmir). Boş — yeni qeyd aktiv olur.', hintEn: 'No deactivates the record (it is not deleted). Empty: new records are active.', exampleAz: 'Bəli', exampleEn: 'Yes', width: 10 };

const emailOf = (companyId: number) => {
  const map = new Map(all<{ id: number; email: string }>('SELECT id, email FROM users WHERE company_id = ?', companyId).map((u) => [u.id, u.email]));
  return (id: number | null) => (id ? map.get(id) ?? null : null);
};

/** Resolves an e-mail column to a user id, with a row warning when the user does not exist (value then stays unchanged). */
function userRef(ctx: Ctx, r: Row, key: string, label: string): number | null | undefined {
  const id = userIdByEmail(ctx.companyId, r.v[key]);
  if (id === -1) {
    ctx.warn(r.row, ctx.m(`${label}: "${str(r.v[key])}" e-poçtu ilə istifadəçi tapılmadı — dəyər dəyişdirilmədi`, `${label}: no user with e-mail "${str(r.v[key])}" — value left unchanged`));
    return undefined;
  }
  return id;
}

function unitByCode(companyId: number, code: string) {
  return get<{ id: number; type_id: number; parent_id: number | null; code: string; name: string; name_en: string | null; description: string | null; head_user_id: number | null; is_active: number; sort_order: number }>(
    'SELECT * FROM org_units WHERE company_id = ? AND code = ? COLLATE NOCASE', companyId, code,
  );
}

const usersRef = (companyId: number) => ({
  nameAz: 'İstifadəçilər', nameEn: 'Users', headersAz: ['E-poçt', 'Ad, soyad', 'Rol'], headersEn: ['E-mail', 'Full name', 'Role'],
  rows: all<{ email: string; full_name: string; role: string }>('SELECT email, full_name, role FROM users WHERE company_id = ? AND is_active = 1 ORDER BY full_name', companyId).map((u) => [u.email, u.full_name, u.role]),
});

const unitsRef = (companyId: number) => {
  const org = OrgIndex.load(companyId);
  return {
    nameAz: 'Struktur vahidləri', nameEn: 'Org units', headersAz: ['Kod', 'Ad', 'Növ', 'Yuxarı vahid', 'Aktiv'], headersEn: ['Code', 'Name', 'Type', 'Parent', 'Active'],
    rows: [...org.units.values()].sort((a, b) => org.path(a.id).join('/').localeCompare(org.path(b.id).join('/')))
      .map((u) => [u.code, u.name, u.typeCode, u.parentId ? org.units.get(u.parentId)?.code ?? '' : '', YES(u.isActive)]),
  };
};

/* =================================================================== org units */

const ORG_UNITS: EntityDef = {
  kind: 'ORG_UNITS', permission: 'org.manage',
  titleAz: 'Təşkilati struktur (vahidlər)', titleEn: 'Organisation structure (units)',
  descriptionAz: 'Divizion, departament, filial, komanda və digər struktur vahidləri. Yuxarı vahid eyni faylda da ola bilər — ardıcıllıq fərq etmir.',
  descriptionEn: 'Divisions, departments, branches, teams and other units. The parent may be in the same file — row order does not matter.',
  matchByAz: 'kod', matchByEn: 'code', sheetAz: 'Vahidlər', sheetEn: 'Units',
  columns: [
    { key: 'code', az: 'Kod', en: 'Code', type: 'code', required: true, hintAz: 'Vahidin unikal kodu. Mövcud kod yazılarsa həmin vahid yenilənir.', hintEn: 'Unique unit code. An existing code updates that unit.', exampleAz: 'SAL-NORTH', width: 16 },
    { key: 'name', az: 'Ad', en: 'Name', type: 'text', required: true, hintAz: 'Azərbaycan dilində ad.', hintEn: 'Name in Azerbaijani.', exampleAz: 'Şimal satış departamenti', width: 30 },
    { key: 'nameEn', az: 'Ad (ingiliscə)', en: 'Name (English)', type: 'text', hintAz: 'İstəyə bağlı.', hintEn: 'Optional.', exampleAz: 'North sales department', width: 28 },
    { key: 'type', az: 'Növ', en: 'Type', type: 'enum', required: 'create', options: (c) => all<{ code: string }>("SELECT code FROM org_unit_types WHERE company_id = ? AND is_active = 1 AND code <> 'COMPANY' ORDER BY sort_order", c).map((t) => t.code), hintAz: 'Vahid növünün kodu (Kodlar vərəqində icazəli yuxarı növlərlə birlikdə).', hintEn: 'Unit type code (see Reference sheet for allowed parent types).', exampleAz: 'DEPARTMENT' },
    { key: 'parentCode', az: 'Yuxarı vahidin kodu', en: 'Parent code', type: 'code', required: 'create', hintAz: 'Mövcud vahidin və ya bu fayldakı vahidin kodu. Şirkətin kök vahidi: ROOT.', hintEn: 'Code of an existing unit or one in this file. The company root is ROOT.', exampleAz: 'COM', width: 18 },
    { key: 'headEmail', az: 'Rəhbərin e-poçtu', en: 'Head e-mail', type: 'email', hintAz: 'Vahidin rəhbəri (təsdiq axınlarında istifadə olunur). İstifadəçi əvvəlcədən mövcud olmalıdır.', hintEn: 'Head of the unit (used by approval workflows). The user must already exist.', exampleAz: 'sales.manager@company.az', width: 26 },
    { key: 'description', az: 'Təsvir', en: 'Description', type: 'text', hintAz: 'İstəyə bağlı.', hintEn: 'Optional.', width: 28 },
    { key: 'sortOrder', az: 'Sıra', en: 'Sort order', type: 'number', hintAz: 'Ağacda göstərilmə ardıcıllığı.', hintEn: 'Display order in the tree.', exampleAz: '10', width: 8 },
    ACTIVE,
  ],
  count: (c) => get<{ n: number }>('SELECT COUNT(*) AS n FROM org_units WHERE company_id = ?', c)!.n,
  prefill: (c) => {
    const org = OrgIndex.load(c);
    const email = emailOf(c);
    return [...org.units.values()].filter((u) => u.parentId !== null)
      .sort((a, b) => org.path(a.id).join('/').localeCompare(org.path(b.id).join('/')))
      .map((u) => ({ code: u.code, name: u.name, nameEn: u.nameEn, type: u.typeCode, parentCode: org.units.get(u.parentId!)?.code ?? null, headEmail: email(u.headUserId), description: u.description, sortOrder: u.sortOrder, active: YES(u.isActive) }));
  },
  reference: (c, lang) => {
    const types = all<{ id: number; code: string; name: string; name_en: string | null; can_have_children: number; in_budgeting: number }>('SELECT * FROM org_unit_types WHERE company_id = ? ORDER BY sort_order', c);
    const parents = allowedParentsMap(c);
    const byId = new Map(types.map((t) => [t.id, t.code]));
    return [
      {
        nameAz: 'Vahid növləri', nameEn: 'Unit types', headersAz: ['Kod', 'Ad', 'İcazəli yuxarı növlər', 'Alt vahid ola bilər', 'Büdcə bölməsi'], headersEn: ['Code', 'Name', 'Allowed parent types', 'Can have children', 'Budget section'],
        rows: types.map((t) => [t.code, lang === 'en' ? t.name_en ?? t.name : t.name, [...(parents.get(t.id) ?? [])].map((p) => byId.get(p)).join(', ') || '—', YES(t.can_have_children, lang), YES(t.in_budgeting, lang)]),
      },
      unitsRef(c),
      usersRef(c),
    ];
  },
  apply: (ctx, rows) => {
    const c = ctx.companyId;
    const allowed = allowedParentsMap(c);
    const types = new Map(all<{ id: number; code: string; is_active: number }>('SELECT id, code, is_active FROM org_unit_types WHERE company_id = ?', c).map((t) => [t.code.toUpperCase(), t]));
    const seen = new Set<string>();
    inDependencyOrder(rows, (r) => str(r.v.code), (r) => str(r.v.parentCode) ?? null, (k) => !!unitByCode(c, k),
      (r, p) => { ctx.error(r.row, ctx.m(`Yuxarı vahid "${p}" tapılmadı (və ya faylda dövr var)`, `Parent unit "${p}" not found (or a cycle in the file)`)); ctx.result(r.row, str(r.v.code)!, 'ERROR'); },
      (r) => {
        const code = str(r.v.code)!;
        ctx.guard(r.row, code, () => {
          if (seen.has(code.toUpperCase())) throw badRequest('DUPLICATE_CODE', ctx.m(`"${code}" kodu faylda təkrarlanır`, `Code "${code}" is repeated in the file`));
          seen.add(code.toUpperCase());
          const existing = unitByCode(c, code);
          const typeCode = str(r.v.type);
          const type = typeCode ? types.get(typeCode.toUpperCase()) : undefined;
          if (typeCode && (!type || type.is_active !== 1)) throw badRequest('INVALID_HIERARCHY', ctx.m(`"${typeCode}" növü tapılmadı və ya deaktivdir`, `Type "${typeCode}" not found or inactive`));
          const parentCode = str(r.v.parentCode);
          const parent = parentCode ? unitByCode(c, parentCode) : undefined;
          if (parentCode && !parent) throw badRequest('INVALID_HIERARCHY', ctx.m(`Yuxarı vahid "${parentCode}" tapılmadı`, `Parent unit "${parentCode}" not found`));
          const headId = userRef(ctx, r, 'headEmail', ctx.m('Rəhbər', 'Head'));
          const idx = OrgIndex.load(c);
          if (!existing) {
            if (!type) throw badRequest('VALIDATION_ERROR', ctx.m('Yeni vahid üçün "Növ" mütləqdir', '"Type" is required for a new unit'));
            if (type.code === 'COMPANY') throw badRequest('INVALID_HIERARCHY', ctx.m('Şirkətin yalnız bir kök vahidi ola bilər', 'There is only one company root'));
            if (!parent) throw badRequest('VALIDATION_ERROR', ctx.m('Yeni vahid üçün "Yuxarı vahidin kodu" mütləqdir', '"Parent code" is required for a new unit'));
            idx.assertValidParent(null, type.id, parent.id, allowed);
            const ts = nowIso();
            const id = run(`INSERT INTO org_units (company_id, type_id, parent_id, code, name, name_en, description, head_user_id, is_active, sort_order, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              c, type.id, parent.id, code, str(r.v.name)!, clearable(r.v.nameEn) ?? null, clearable(r.v.description) ?? null, headId ?? null, +bool(r.v.active, true),
              typeof r.v.sortOrder === 'number' ? r.v.sortOrder : 0, ts, ts).lastInsertRowid;
            ctx.audit('ORG_UNIT', id, 'CREATED', { code, parent: parent.code, type: type.code });
            ctx.result(r.row, code, 'CREATE');
            return;
          }
          if (ctx.opts.mode === 'create') { ctx.result(r.row, code, 'SKIP'); ctx.warn(r.row, ctx.m(`"${code}" artıq mövcuddur — ötürüldü`, `"${code}" already exists — skipped`)); return; }
          const isRoot = existing.parent_id === null;
          const next = { ...existing };
          const changes: string[] = [];
          setField(next, 'name', r.v.name, changes, ctx.m('ad', 'name'));
          setField(next, 'name_en', r.v.nameEn, changes, ctx.m('ingiliscə ad', 'English name'));
          setField(next, 'description', r.v.description, changes, ctx.m('təsvir', 'description'));
          setField(next, 'head_user_id', headId, changes, ctx.m('rəhbər', 'head'));
          if (typeof r.v.sortOrder === 'number') setField(next, 'sort_order', r.v.sortOrder, changes, ctx.m('sıra', 'sort order'));
          if (typeof r.v.active === 'boolean') setField(next, 'is_active', +r.v.active, changes, ctx.m('aktivlik', 'active'));
          if (!isRoot) {
            if (type) setField(next, 'type_id', type.id, changes, ctx.m('növ', 'type'));
            if (parent) setField(next, 'parent_id', parent.id, changes, ctx.m('yuxarı vahid', 'parent'));
          } else if ((parent && parent.id !== existing.id) || (type && type.id !== existing.type_id)) {
            throw badRequest('INVALID_HIERARCHY', ctx.m('Şirkətin kök vahidi köçürülə və ya növü dəyişdirilə bilməz', 'The company root cannot be moved or change type'));
          }
          if (isRoot && next.is_active === 0) throw badRequest('INVALID_HIERARCHY', ctx.m('Kök vahid deaktiv edilə bilməz', 'The company root cannot be deactivated'));
          if (!changes.length) { ctx.result(r.row, code, 'UNCHANGED'); return; }
          if (!isRoot && (next.parent_id !== existing.parent_id || next.type_id !== existing.type_id)) idx.assertValidParent(existing.id, next.type_id, next.parent_id, allowed);
          if (next.is_active === 0 && existing.is_active === 1) {
            const activeCcs = idx.ccsInSubtree(existing.id).filter((x) => x.isActive);
            if (activeCcs.length) throw conflict('IN_USE', ctx.m(`Əvvəlcə xərc mərkəzlərini deaktiv edin və ya köçürün (${activeCcs.map((x) => x.code).join(', ')})`, `Deactivate or move its cost centers first (${activeCcs.map((x) => x.code).join(', ')})`));
          }
          run(`UPDATE org_units SET type_id = ?, parent_id = ?, name = ?, name_en = ?, description = ?, head_user_id = ?, is_active = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
            next.type_id, next.parent_id, next.name, next.name_en, next.description, next.head_user_id, next.is_active, next.sort_order, nowIso(), existing.id);
          ctx.audit('ORG_UNIT', existing.id, next.parent_id !== existing.parent_id ? 'MOVED' : 'UPDATED', { changes });
          ctx.result(r.row, code, 'UPDATE', changes);
        });
      });
  },
};

/* =================================================================== job families */

const JOB_FAMILIES: EntityDef = {
  kind: 'JOB_FAMILIES', permission: 'org.manage',
  titleAz: 'Peşə ailələri', titleEn: 'Job families',
  descriptionAz: 'Peşə ailələri (HR, Maliyyə, İT …) və onların sahibləri. Sahib "Peşə ailəsinin sahibi" təsdiq mərhələsində istifadə olunur.',
  descriptionEn: 'Job families (HR, Finance, IT …) and their owners. The owner is used by the "Job family owner" approval step.',
  matchByAz: 'kod', matchByEn: 'code', sheetAz: 'Peşə ailələri', sheetEn: 'Job families',
  columns: [
    { key: 'code', az: 'Kod', en: 'Code', type: 'code', required: true, hintAz: 'Unikal kod.', hintEn: 'Unique code.', exampleAz: 'HR' },
    { key: 'name', az: 'Ad', en: 'Name', type: 'text', required: true, hintAz: 'Peşə ailəsinin adı.', hintEn: 'Job family name.', exampleAz: 'İnsan resursları', width: 28 },
    { key: 'ownerEmail', az: 'Sahibin e-poçtu', en: 'Owner e-mail', type: 'email', hintAz: 'İstifadəçi əvvəlcədən mövcud olmalıdır.', hintEn: 'The user must already exist.', exampleAz: 'people.director@company.az', width: 28 },
    ACTIVE,
  ],
  count: (c) => get<{ n: number }>('SELECT COUNT(*) AS n FROM job_families WHERE company_id = ?', c)!.n,
  prefill: (c) => {
    const email = emailOf(c);
    return all<{ code: string; name: string; owner_user_id: number | null; is_active: number }>('SELECT * FROM job_families WHERE company_id = ? ORDER BY code', c)
      .map((j) => ({ code: j.code, name: j.name, ownerEmail: email(j.owner_user_id), active: YES(j.is_active) }));
  },
  reference: (c) => [usersRef(c)],
  apply: (ctx, rows) => {
    const c = ctx.companyId;
    const seen = new Set<string>();
    for (const r of rows) {
      const code = str(r.v.code)!;
      ctx.guard(r.row, code, () => {
        if (seen.has(code.toUpperCase())) throw badRequest('DUPLICATE_CODE', ctx.m(`"${code}" kodu faylda təkrarlanır`, `Code "${code}" is repeated in the file`));
        seen.add(code.toUpperCase());
        const owner = userRef(ctx, r, 'ownerEmail', ctx.m('Sahib', 'Owner'));
        const ex = get<{ id: number; code: string; name: string; owner_user_id: number | null; is_active: number }>('SELECT * FROM job_families WHERE company_id = ? AND code = ? COLLATE NOCASE', c, code);
        if (!ex) {
          const id = run('INSERT INTO job_families (company_id, code, name, owner_user_id, is_active) VALUES (?, ?, ?, ?, ?)', c, code, str(r.v.name)!, owner ?? null, +bool(r.v.active, true)).lastInsertRowid;
          ctx.audit('JOB_FAMILY', id, 'CREATED', { code });
          ctx.result(r.row, code, 'CREATE');
          return;
        }
        if (ctx.opts.mode === 'create') { ctx.result(r.row, code, 'SKIP'); return; }
        const next = { ...ex };
        const changes: string[] = [];
        setField(next, 'name', r.v.name, changes, ctx.m('ad', 'name'));
        setField(next, 'owner_user_id', owner, changes, ctx.m('sahib', 'owner'));
        if (typeof r.v.active === 'boolean') setField(next, 'is_active', +r.v.active, changes, ctx.m('aktivlik', 'active'));
        if (!changes.length) { ctx.result(r.row, code, 'UNCHANGED'); return; }
        run('UPDATE job_families SET name = ?, owner_user_id = ?, is_active = ? WHERE id = ?', next.name, next.owner_user_id, next.is_active, ex.id);
        ctx.audit('JOB_FAMILY', ex.id, 'UPDATED', { changes });
        ctx.result(r.row, code, 'UPDATE', changes);
      });
    }
  },
};

/* =================================================================== users */

const ROLE_NAMES: Record<string, [string, string]> = {
  ADMIN: ['Administrator', 'Administrator'], CEO: ['Baş icraçı direktor', 'Chief executive'], CFO: ['Maliyyə direktoru', 'Chief financial officer'],
  FINANCE_MANAGER: ['Maliyyə meneceri', 'Finance manager'], DEPARTMENT_MANAGER: ['Departament rəhbəri', 'Department head'],
  COST_CENTER_OWNER: ['Xərc mərkəzi sahibi', 'Cost center owner'], EMPLOYEE: ['Əməkdaş', 'Employee'], VIEWER: ['Baxış hüququ', 'Viewer'],
};

type UserRec = { id: number; email: string; full_name: string; role: string; org_unit_id: number | null; manager_id: number | null; job_family_id: number | null; job_title: string | null; language: string; is_active: number };

const USERS: EntityDef = {
  kind: 'USERS', permission: 'users.manage', needsPassword: true,
  titleAz: 'İstifadəçilər', titleEn: 'Users',
  descriptionAz: 'İstifadəçilər, rolları, struktur vahidi, birbaşa rəhbəri və peşə ailəsi. Şifrələr faylda saxlanılmır: yeni istifadəçilərə idxal pəncərəsində verilən ilkin şifrə təyin olunur.',
  descriptionEn: 'Users with role, org unit, line manager and job family. Passwords are never stored in the file: new users get the initial password entered in the import dialog.',
  matchByAz: 'e-poçt', matchByEn: 'e-mail', sheetAz: 'İstifadəçilər', sheetEn: 'Users',
  columns: [
    { key: 'email', az: 'E-poçt', en: 'E-mail', type: 'email', required: true, hintAz: 'Giriş üçün e-poçt (unikal). Mövcud e-poçt yazılarsa həmin istifadəçi yenilənir.', hintEn: 'Login e-mail (unique). An existing e-mail updates that user.', exampleAz: 'leyla.huseynova@company.az', width: 30 },
    { key: 'fullName', az: 'Ad, soyad', en: 'Full name', type: 'text', required: true, hintAz: 'Tam ad.', hintEn: 'Full name.', exampleAz: 'Leyla Hüseynova', width: 24 },
    { key: 'role', az: 'Rol', en: 'Role', type: 'enum', required: 'create', options: () => [...COMPANY_ROLES], hintAz: 'Rolun kodu (Kodlar vərəqinə baxın).', hintEn: 'Role code (see Reference sheet).', exampleAz: 'FINANCE_MANAGER', width: 20 },
    { key: 'unitCode', az: 'Struktur vahidinin kodu', en: 'Org unit code', type: 'code', hintAz: 'İstifadəçinin işlədiyi vahid. Departament rəhbəri və əməkdaşın görünürlüyü buna görə müəyyən olunur.', hintEn: 'The unit the user belongs to. Drives what department heads and employees can see.', exampleAz: 'FIN', width: 18 },
    { key: 'managerEmail', az: 'Rəhbərin e-poçtu', en: 'Manager e-mail', type: 'email', hintAz: 'Birbaşa rəhbər ("Sorğu edənin rəhbəri" təsdiq mərhələsi). Bu faylda da ola bilər.', hintEn: 'Line manager (the "Requester\'s manager" approval step). May be in this file.', exampleAz: 'cfo@company.az', width: 26 },
    { key: 'jobFamilyCode', az: 'Peşə ailəsinin kodu', en: 'Job family code', type: 'code', hintAz: 'İstəyə bağlı.', hintEn: 'Optional.', exampleAz: 'FIN', width: 16 },
    { key: 'jobTitle', az: 'Vəzifə', en: 'Job title', type: 'text', hintAz: 'İstəyə bağlı.', hintEn: 'Optional.', exampleAz: 'Maliyyə meneceri', width: 22 },
    { key: 'language', az: 'Dil', en: 'Language', type: 'enum', options: () => ['az', 'en'], hintAz: 'İnterfeys dili: az və ya en. Yalnız yeni istifadəçi üçün; sonra istifadəçi özü dəyişir.', hintEn: 'Interface language: az or en. New users only; afterwards users change it themselves.', exampleAz: 'az', width: 8 },
    ACTIVE,
  ],
  count: (c) => get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE company_id = ?', c)!.n,
  prefill: (c) => {
    const email = emailOf(c);
    const units = new Map(all<{ id: number; code: string }>('SELECT id, code FROM org_units WHERE company_id = ?', c).map((u) => [u.id, u.code]));
    const jf = new Map(all<{ id: number; code: string }>('SELECT id, code FROM job_families WHERE company_id = ?', c).map((u) => [u.id, u.code]));
    return all<UserRec>('SELECT * FROM users WHERE company_id = ? ORDER BY full_name', c).map((u) => ({
      email: u.email, fullName: u.full_name, role: u.role, unitCode: u.org_unit_id ? units.get(u.org_unit_id) ?? null : null, managerEmail: email(u.manager_id),
      jobFamilyCode: u.job_family_id ? jf.get(u.job_family_id) ?? null : null, jobTitle: u.job_title, language: u.language, active: YES(u.is_active),
    }));
  },
  reference: (c, lang) => [
    { nameAz: 'Rollar', nameEn: 'Roles', headersAz: ['Kod', 'Ad'], headersEn: ['Code', 'Name'], rows: COMPANY_ROLES.map((r) => [r, ROLE_NAMES[r]?.[lang === 'en' ? 1 : 0] ?? r]) },
    unitsRef(c),
    { nameAz: 'Peşə ailələri', nameEn: 'Job families', headersAz: ['Kod', 'Ad'], headersEn: ['Code', 'Name'], rows: all<{ code: string; name: string }>('SELECT code, name FROM job_families WHERE company_id = ? AND is_active = 1 ORDER BY code', c).map((j) => [j.code, j.name]) },
    usersRef(c),
  ],
  apply: (ctx, rows) => {
    const c = ctx.companyId;
    const seen = new Set<string>();
    const done: { r: Row; id: number }[] = [];
    const outcome = new Map<number, { key: string; action: 'CREATE' | 'UPDATE' | 'UNCHANGED'; changes: string[] }>();
    // pass 1: create / update everything except the manager (managers may be created later in the same file)
    for (const r of rows) {
      const email = str(r.v.email)!;
      ctx.guard(r.row, email, () => {
        if (seen.has(email)) throw badRequest('CONFLICT', ctx.m(`"${email}" faylda təkrarlanır`, `"${email}" is repeated in the file`));
        seen.add(email);
        const unitCode = str(r.v.unitCode);
        const unit = unitCode ? unitByCode(c, unitCode) : undefined;
        if (unitCode && !unit) throw badRequest('VALIDATION_ERROR', ctx.m(`Struktur vahidi "${unitCode}" tapılmadı`, `Org unit "${unitCode}" not found`));
        const jfCode = str(r.v.jobFamilyCode);
        const jf = jfCode ? get<{ id: number }>('SELECT id FROM job_families WHERE company_id = ? AND code = ? COLLATE NOCASE', c, jfCode) : undefined;
        if (jfCode && !jf) throw badRequest('VALIDATION_ERROR', ctx.m(`Peşə ailəsi "${jfCode}" tapılmadı`, `Job family "${jfCode}" not found`));
        const ex = get<UserRec & { company_id: number | null }>('SELECT * FROM users WHERE email = ? COLLATE NOCASE', email);
        if (ex && ex.company_id !== c) throw badRequest('CONFLICT', ctx.m(`"${email}" e-poçtu artıq istifadə olunur`, `E-mail "${email}" is already in use`));
        if (!ex) {
          const role = str(r.v.role);
          if (!role) throw badRequest('VALIDATION_ERROR', ctx.m('Yeni istifadəçi üçün "Rol" mütləqdir', '"Role" is required for a new user'));
          if (!ctx.opts.initialPassword) throw badRequest('VALIDATION_ERROR', ctx.m('Yeni istifadəçilər üçün idxal pəncərəsində ilkin şifrə daxil edin', 'Enter an initial password for new users in the import dialog'));
          const active = bool(r.v.active, true);
          if (active) assertSeatAvailable(c);
          const id = Number(run(`INSERT INTO users (company_id, email, full_name, password_hash, role, org_unit_id, job_family_id, job_title, language, is_active, created_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            c, email, str(r.v.fullName)!, hashPassword(ctx.opts.initialPassword), role, unit?.id ?? null, jf?.id ?? null, clearable(r.v.jobTitle) ?? null,
            str(r.v.language) ?? 'az', +active, nowIso()).lastInsertRowid);
          ctx.audit('USER', id, 'CREATED', { email, role });
          outcome.set(r.row, { key: email, action: 'CREATE', changes: [] });
          done.push({ r, id });
          return;
        }
        if (ctx.opts.mode === 'create') { ctx.result(r.row, email, 'SKIP'); return; }
        const next = { ...ex };
        const changes: string[] = [];
        setField(next, 'full_name', r.v.fullName, changes, ctx.m('ad', 'name'));
        setField(next, 'role', r.v.role, changes, ctx.m('rol', 'role'));
        setField(next, 'org_unit_id', r.v.unitCode === CLEAR ? CLEAR : unit?.id, changes, ctx.m('vahid', 'unit'));
        setField(next, 'job_family_id', r.v.jobFamilyCode === CLEAR ? CLEAR : jf?.id, changes, ctx.m('peşə ailəsi', 'job family'));
        setField(next, 'job_title', r.v.jobTitle, changes, ctx.m('vəzifə', 'job title'));
        if (typeof r.v.active === 'boolean') setField(next, 'is_active', +r.v.active, changes, ctx.m('aktivlik', 'active'));
        if (ex.id === ctx.user.id && (next.role !== ex.role || next.is_active === 0)) {
          throw badRequest('VALIDATION_ERROR', ctx.m('Öz rolunuzu dəyişə və ya özünüzü deaktiv edə bilməzsiniz', 'You cannot change your own role or deactivate yourself'));
        }
        if (next.is_active === 1 && ex.is_active === 0) assertSeatAvailable(c);
        if (changes.length) {
          run('UPDATE users SET full_name = ?, role = ?, org_unit_id = ?, job_family_id = ?, job_title = ?, is_active = ? WHERE id = ?',
            next.full_name, next.role, next.org_unit_id, next.job_family_id, next.job_title, next.is_active, ex.id);
          ctx.audit('USER', ex.id, 'UPDATED', { changes });
        }
        done.push({ r, id: ex.id });
        outcome.set(r.row, { key: email, action: changes.length ? 'UPDATE' : 'UNCHANGED', changes });
      });
    }
    // pass 2: line managers (the manager may have been created above)
    for (const { r, id } of done) {
      if (r.v.managerEmail === undefined) continue;
      const managerId = userIdByEmail(c, r.v.managerEmail);
      if (managerId === -1) { ctx.warn(r.row, ctx.m(`Rəhbər "${str(r.v.managerEmail)}" tapılmadı — təyin edilmədi`, `Manager "${str(r.v.managerEmail)}" not found — not set`)); continue; }
      if (managerId === id) {
        ctx.error(r.row, ctx.m('İstifadəçi öz rəhbəri ola bilməz', 'A user cannot be their own manager'));
        outcome.delete(r.row);
        ctx.result(r.row, str(r.v.email)!, 'ERROR');
        continue;
      }
      const cur = get<{ manager_id: number | null }>('SELECT manager_id FROM users WHERE id = ?', id)!.manager_id;
      if ((cur ?? null) === (managerId ?? null)) continue;
      run('UPDATE users SET manager_id = ? WHERE id = ?', managerId ?? null, id);
      const o = outcome.get(r.row);
      if (o && o.action !== 'CREATE') {
        ctx.audit('USER', id, 'UPDATED', { changes: [ctx.m('rəhbər', 'manager')] });
        o.action = 'UPDATE';
        o.changes.push(ctx.m('rəhbər', 'manager'));
      }
    }
    for (const [row, o] of outcome) ctx.result(row, o.key, o.action, o.changes);
  },
};

/* =================================================================== positions */

const POSITIONS: EntityDef = {
  kind: 'POSITIONS', permission: 'org.manage',
  titleAz: 'Vəzifələr', titleEn: 'Positions',
  descriptionAz: 'Vəzifələr və vəzifə sahibləri ("Vəzifə sahibi" təsdiq mərhələsi üçün).',
  descriptionEn: 'Positions and their holders (for the "Position holder" approval step).',
  matchByAz: 'kod', matchByEn: 'code', sheetAz: 'Vəzifələr', sheetEn: 'Positions',
  columns: [
    { key: 'code', az: 'Kod', en: 'Code', type: 'code', required: true, hintAz: 'Unikal kod.', hintEn: 'Unique code.', exampleAz: 'POS-CFO' },
    { key: 'title', az: 'Vəzifənin adı', en: 'Title', type: 'text', required: true, hintAz: 'Vəzifənin adı.', hintEn: 'Position title.', exampleAz: 'Maliyyə direktoru', width: 26 },
    { key: 'unitCode', az: 'Struktur vahidinin kodu', en: 'Org unit code', type: 'code', hintAz: 'İstəyə bağlı.', hintEn: 'Optional.', exampleAz: 'FIN', width: 18 },
    { key: 'holderEmail', az: 'Vəzifə sahibinin e-poçtu', en: 'Holder e-mail', type: 'email', hintAz: 'İstifadəçi əvvəlcədən mövcud olmalıdır.', hintEn: 'The user must already exist.', exampleAz: 'cfo@company.az', width: 26 },
    ACTIVE,
  ],
  count: (c) => get<{ n: number }>('SELECT COUNT(*) AS n FROM positions WHERE company_id = ?', c)!.n,
  prefill: (c) => {
    const email = emailOf(c);
    const units = new Map(all<{ id: number; code: string }>('SELECT id, code FROM org_units WHERE company_id = ?', c).map((u) => [u.id, u.code]));
    return all<{ code: string; title: string; org_unit_id: number | null; holder_user_id: number | null; is_active: number }>('SELECT * FROM positions WHERE company_id = ? ORDER BY code', c)
      .map((p) => ({ code: p.code, title: p.title, unitCode: p.org_unit_id ? units.get(p.org_unit_id) ?? null : null, holderEmail: email(p.holder_user_id), active: YES(p.is_active) }));
  },
  reference: (c) => [unitsRef(c), usersRef(c)],
  apply: (ctx, rows) => {
    const c = ctx.companyId;
    const seen = new Set<string>();
    for (const r of rows) {
      const code = str(r.v.code)!;
      ctx.guard(r.row, code, () => {
        if (seen.has(code.toUpperCase())) throw badRequest('DUPLICATE_CODE', ctx.m(`"${code}" kodu faylda təkrarlanır`, `Code "${code}" is repeated in the file`));
        seen.add(code.toUpperCase());
        const unitCode = str(r.v.unitCode);
        const unit = unitCode ? unitByCode(c, unitCode) : undefined;
        if (unitCode && !unit) throw badRequest('VALIDATION_ERROR', ctx.m(`Struktur vahidi "${unitCode}" tapılmadı`, `Org unit "${unitCode}" not found`));
        const holder = userRef(ctx, r, 'holderEmail', ctx.m('Vəzifə sahibi', 'Holder'));
        const ex = get<{ id: number; title: string; org_unit_id: number | null; holder_user_id: number | null; is_active: number }>('SELECT * FROM positions WHERE company_id = ? AND code = ? COLLATE NOCASE', c, code);
        if (!ex) {
          const id = run('INSERT INTO positions (company_id, code, title, org_unit_id, holder_user_id, is_active) VALUES (?, ?, ?, ?, ?, ?)',
            c, code, str(r.v.title)!, unit?.id ?? null, holder ?? null, +bool(r.v.active, true)).lastInsertRowid;
          ctx.audit('POSITION', id, 'CREATED', { code });
          ctx.result(r.row, code, 'CREATE');
          return;
        }
        if (ctx.opts.mode === 'create') { ctx.result(r.row, code, 'SKIP'); return; }
        const next = { ...ex };
        const changes: string[] = [];
        setField(next, 'title', r.v.title, changes, ctx.m('ad', 'title'));
        setField(next, 'org_unit_id', r.v.unitCode === CLEAR ? CLEAR : unit?.id, changes, ctx.m('vahid', 'unit'));
        setField(next, 'holder_user_id', holder, changes, ctx.m('sahib', 'holder'));
        if (typeof r.v.active === 'boolean') setField(next, 'is_active', +r.v.active, changes, ctx.m('aktivlik', 'active'));
        if (!changes.length) { ctx.result(r.row, code, 'UNCHANGED'); return; }
        run('UPDATE positions SET title = ?, org_unit_id = ?, holder_user_id = ?, is_active = ? WHERE id = ?', next.title, next.org_unit_id, next.holder_user_id, next.is_active, ex.id);
        ctx.audit('POSITION', ex.id, 'UPDATED', { changes });
        ctx.result(r.row, code, 'UPDATE', changes);
      });
    }
  },
};

/* =================================================================== chart of accounts */

type AccRec = { id: number; parent_id: number | null; code: string; name: string; name_en: string | null; description: string | null; account_type: string; category: string | null; expense_class: string | null; is_group: number; allow_budgeting: number; allow_requests: number; currency: string | null; is_active: number; sort_order: number };
const accByCode = (c: number, code: string) => get<AccRec>('SELECT * FROM accounts WHERE company_id = ? AND code = ? COLLATE NOCASE', c, code);
const hasPostings = (id: number) => !!get('SELECT 1 FROM budget_lines WHERE account_id = ? UNION SELECT 1 FROM actuals WHERE account_id = ? UNION SELECT 1 FROM purchase_requests WHERE account_id = ? LIMIT 1', id, id, id);
const currencies = () => all<{ code: string }>('SELECT code FROM currencies ORDER BY code').map((x) => x.code);

const ACCOUNTS: EntityDef = {
  kind: 'ACCOUNTS', permission: 'coa.manage',
  titleAz: 'Hesablar planı', titleEn: 'Chart of accounts',
  descriptionAz: 'Qrup və alt hesablar. Alt hesab yazılan qrup hesabı lazım olduqda avtomatik qrupa çevrilir. Yuxarı hesab eyni faylda da ola bilər.',
  descriptionEn: 'Group and postable accounts. A parent that receives sub-accounts becomes a group automatically. The parent may be in the same file.',
  matchByAz: 'hesab kodu', matchByEn: 'account code', sheetAz: 'Hesablar', sheetEn: 'Accounts',
  columns: [
    { key: 'code', az: 'Hesab kodu', en: 'Account code', type: 'code', required: true, hintAz: 'Unikal hesab kodu (məs. 721-01).', hintEn: 'Unique account code (e.g. 721-01).', exampleAz: '721-15', width: 14 },
    { key: 'name', az: 'Ad', en: 'Name', type: 'text', required: true, hintAz: 'Hesabın adı.', hintEn: 'Account name.', exampleAz: 'Kommunal xərclər', width: 32 },
    { key: 'nameEn', az: 'Ad (ingiliscə)', en: 'Name (English)', type: 'text', hintAz: 'İstəyə bağlı.', hintEn: 'Optional.', exampleAz: 'Utilities', width: 28 },
    { key: 'parentCode', az: 'Yuxarı hesabın kodu', en: 'Parent code', type: 'code', hintAz: 'Boş — ən yuxarı səviyyə. Mövcud və ya bu fayldakı hesab.', hintEn: 'Empty: top level. An existing account or one in this file.', exampleAz: '721', width: 16 },
    { key: 'accountType', az: 'Hesabın növü', en: 'Account type', type: 'enum', required: 'create', options: () => ['EXPENSE', 'REVENUE', 'CAPEX', 'OTHER'], hintAz: 'EXPENSE — xərc, REVENUE — gəlir, CAPEX — kapital qoyuluşu, OTHER — digər.', hintEn: 'EXPENSE, REVENUE, CAPEX or OTHER.', exampleAz: 'EXPENSE', width: 14 },
    { key: 'expenseClass', az: 'Xərc sinfi', en: 'Expense class', type: 'enum', options: () => ['OPEX', 'CAPEX'], hintAz: 'OPEX və ya CAPEX. Boş — yuxarı hesabdan götürülür.', hintEn: 'OPEX or CAPEX. Empty: inherited from the parent.', exampleAz: 'OPEX', width: 12 },
    { key: 'category', az: 'Kateqoriya', en: 'Category', type: 'text', hintAz: 'Hesabat üçün qruplaşdırma (məs. Kadr, İnzibati).', hintEn: 'Reporting group (e.g. Personnel, Admin).', width: 16 },
    { key: 'isGroup', az: 'Qrup hesabı', en: 'Group account', type: 'bool', hintAz: 'Bəli — yalnız alt hesabları birləşdirir, ona məbləğ yazılmır.', hintEn: 'Yes: only aggregates sub-accounts, no postings.', exampleAz: 'Xeyr', exampleEn: 'No', width: 12 },
    { key: 'allowBudgeting', az: 'Büdcələşdirməyə icazə', en: 'Allow budgeting', type: 'bool', hintAz: 'Boş — Bəli.', hintEn: 'Empty: Yes.', width: 14 },
    { key: 'allowRequests', az: 'Sorğulara icazə', en: 'Allow requests', type: 'bool', hintAz: 'Satınalma / xərc sorğularında seçilə bilər. Boş — Bəli.', hintEn: 'Selectable in purchase / expense requests. Empty: Yes.', width: 14 },
    { key: 'currency', az: 'Valyuta', en: 'Currency', type: 'enum', options: currencies, hintAz: 'İstəyə bağlı: hesab yalnız bu valyutada aparılırsa.', hintEn: 'Optional: only if the account is kept in this currency.', width: 10 },
    { key: 'description', az: 'Təsvir', en: 'Description', type: 'text', hintAz: 'İstəyə bağlı.', hintEn: 'Optional.', width: 28 },
    { key: 'sortOrder', az: 'Sıra', en: 'Sort order', type: 'number', hintAz: 'Göstərilmə ardıcıllığı.', hintEn: 'Display order.', width: 8 },
    ACTIVE,
  ],
  count: (c) => get<{ n: number }>('SELECT COUNT(*) AS n FROM accounts WHERE company_id = ?', c)!.n,
  prefill: (c) => {
    const idx = AccountIndex.load(c);
    const rows = new Map(all<AccRec>('SELECT * FROM accounts WHERE company_id = ?', c).map((a) => [a.id, a]));
    const out: Record<string, string | number | null>[] = [];
    const walk = (parent: number | null) => {
      for (const id of idx.children.get(parent) ?? []) {
        const a = rows.get(id)!;
        out.push({
          code: a.code, name: a.name, nameEn: a.name_en, parentCode: a.parent_id ? rows.get(a.parent_id)?.code ?? null : null, accountType: a.account_type,
          expenseClass: a.expense_class, category: a.category, isGroup: YES(a.is_group), allowBudgeting: YES(a.allow_budgeting), allowRequests: YES(a.allow_requests),
          currency: a.currency, description: a.description, sortOrder: a.sort_order, active: YES(a.is_active),
        });
        walk(id);
      }
    };
    walk(null);
    return out;
  },
  reference: (c) => [{
    nameAz: 'Mövcud qrup hesabları', nameEn: 'Existing group accounts', headersAz: ['Kod', 'Ad', 'Növ', 'Xərc sinfi'], headersEn: ['Code', 'Name', 'Type', 'Expense class'],
    rows: all<AccRec>('SELECT * FROM accounts WHERE company_id = ? AND is_group = 1 ORDER BY code', c).map((a) => [a.code, a.name, a.account_type, a.expense_class ?? '']),
  }],
  apply: (ctx, rows) => {
    const c = ctx.companyId;
    const seen = new Set<string>();
    inDependencyOrder(rows, (r) => str(r.v.code), (r) => str(r.v.parentCode) ?? null, (k) => !!accByCode(c, k),
      (r, p) => { ctx.error(r.row, ctx.m(`Yuxarı hesab "${p}" tapılmadı (və ya faylda dövr var)`, `Parent account "${p}" not found (or a cycle in the file)`)); ctx.result(r.row, str(r.v.code)!, 'ERROR'); },
      (r) => {
        const code = str(r.v.code)!;
        ctx.guard(r.row, code, () => {
          if (seen.has(code.toUpperCase())) throw badRequest('DUPLICATE_CODE', ctx.m(`"${code}" kodu faylda təkrarlanır`, `Code "${code}" is repeated in the file`));
          seen.add(code.toUpperCase());
          const parentCode = str(r.v.parentCode);
          const parent = parentCode ? accByCode(c, parentCode) : undefined;
          if (parentCode && !parent) throw badRequest('INVALID_HIERARCHY', ctx.m(`Yuxarı hesab "${parentCode}" tapılmadı`, `Parent account "${parentCode}" not found`));
          const ex = accByCode(c, code);
          if (ex && ctx.opts.mode === 'create') { ctx.result(r.row, code, 'SKIP'); return; }
          const makeParentGroup = () => {
            if (parent && !parent.is_group) {
              if (hasPostings(parent.id)) throw badRequest('VALIDATION_ERROR', ctx.m(`${parent.code} hesabında əməliyyatlar var, qrupa çevrilə bilməz`, `Account ${parent.code} has postings and cannot become a group`));
              run('UPDATE accounts SET is_group = 1, updated_at = ? WHERE id = ?', nowIso(), parent.id);
              ctx.warn(r.row, ctx.m(`${parent.code} hesabı qrup hesabına çevrildi`, `Account ${parent.code} became a group account`));
            }
          };
          if (!ex) {
            const type = str(r.v.accountType);
            if (!type) throw badRequest('VALIDATION_ERROR', ctx.m('Yeni hesab üçün "Hesabın növü" mütləqdir', '"Account type" is required for a new account'));
            makeParentGroup();
            const ts = nowIso();
            const id = run(`INSERT INTO accounts (company_id, parent_id, code, name, name_en, description, account_type, category, expense_class, is_group, allow_budgeting, allow_requests, currency, is_active, sort_order, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              c, parent?.id ?? null, code, str(r.v.name)!, clearable(r.v.nameEn) ?? null, clearable(r.v.description) ?? null, type, clearable(r.v.category) ?? null,
              clearable(r.v.expenseClass) ?? null, +bool(r.v.isGroup, false), +bool(r.v.allowBudgeting, true), +bool(r.v.allowRequests, true), clearable(r.v.currency) ?? null,
              +bool(r.v.active, true), typeof r.v.sortOrder === 'number' ? r.v.sortOrder : 0, ts, ts).lastInsertRowid;
            ctx.audit('ACCOUNT', id, 'CREATED', { code });
            ctx.result(r.row, code, 'CREATE');
            return;
          }
          const next = { ...ex };
          const changes: string[] = [];
          setField(next, 'name', r.v.name, changes, ctx.m('ad', 'name'));
          setField(next, 'name_en', r.v.nameEn, changes, ctx.m('ingiliscə ad', 'English name'));
          setField(next, 'description', r.v.description, changes, ctx.m('təsvir', 'description'));
          setField(next, 'account_type', r.v.accountType, changes, ctx.m('növ', 'type'));
          setField(next, 'category', r.v.category, changes, ctx.m('kateqoriya', 'category'));
          setField(next, 'expense_class', r.v.expenseClass, changes, ctx.m('xərc sinfi', 'expense class'));
          setField(next, 'currency', r.v.currency, changes, ctx.m('valyuta', 'currency'));
          for (const [k, col, label] of [['is_group', 'isGroup', ctx.m('qrup', 'group')], ['allow_budgeting', 'allowBudgeting', ctx.m('büdcəyə icazə', 'budgeting')], ['allow_requests', 'allowRequests', ctx.m('sorğulara icazə', 'requests')], ['is_active', 'active', ctx.m('aktivlik', 'active')]] as const) {
            const v = r.v[col];
            if (typeof v === 'boolean') setField(next, k, +v, changes, label);
          }
          if (typeof r.v.sortOrder === 'number') setField(next, 'sort_order', r.v.sortOrder, changes, ctx.m('sıra', 'sort order'));
          if (r.v.parentCode === CLEAR) setField(next, 'parent_id', CLEAR, changes, ctx.m('yuxarı hesab', 'parent'));
          else if (parent) {
            if (parent.id === ex.id || AccountIndex.load(c).descendants(ex.id).has(parent.id)) {
              throw badRequest('INVALID_HIERARCHY', ctx.m('Hesab öz alt hesabının altına köçürülə bilməz', 'An account cannot be moved under itself or its sub-accounts'));
            }
            setField(next, 'parent_id', parent.id, changes, ctx.m('yuxarı hesab', 'parent'));
          }
          if (!changes.length) { ctx.result(r.row, code, 'UNCHANGED'); return; }
          if (next.is_group === 1 && ex.is_group === 0 && hasPostings(ex.id)) throw badRequest('VALIDATION_ERROR', ctx.m('Əməliyyatı olan hesab qrupa çevrilə bilməz', 'An account with postings cannot become a group'));
          if (next.is_group === 0 && ex.is_group === 1 && get('SELECT 1 FROM accounts WHERE parent_id = ? LIMIT 1', ex.id)) throw badRequest('VALIDATION_ERROR', ctx.m('Əvvəlcə alt hesabları köçürün', 'Move its sub-accounts first'));
          if (next.parent_id !== ex.parent_id) makeParentGroup();
          run(`UPDATE accounts SET parent_id = ?, name = ?, name_en = ?, description = ?, account_type = ?, category = ?, expense_class = ?, is_group = ?,
                 allow_budgeting = ?, allow_requests = ?, currency = ?, is_active = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
            next.parent_id, next.name, next.name_en, next.description, next.account_type, next.category, next.expense_class, next.is_group,
            next.allow_budgeting, next.allow_requests, next.currency, next.is_active, next.sort_order, nowIso(), ex.id);
          ctx.audit('ACCOUNT', ex.id, 'UPDATED', { changes });
          ctx.result(r.row, code, 'UPDATE', changes);
        });
      });
  },
};

/* =================================================================== cost centers */

type CcRec = { id: number; org_unit_id: number; code: string; name: string; description: string | null; owner_user_id: number | null; responsible_user_id: number | null; currency: string; valid_from: string | null; valid_to: string | null; is_active: number };

const COST_CENTERS: EntityDef = {
  kind: 'COST_CENTERS', permission: 'org.manage',
  titleAz: 'Xərc mərkəzləri', titleEn: 'Cost centers',
  descriptionAz: 'Xərc mərkəzləri, onların struktur vahidi, sahibi, məsul şəxsi və icazəli hesabları. Əvvəlcə struktur vahidlərini və hesabları idxal edin.',
  descriptionEn: 'Cost centers with org unit, owner, responsible person and allowed accounts. Import org units and accounts first.',
  matchByAz: 'kod', matchByEn: 'code', sheetAz: 'Xərc mərkəzləri', sheetEn: 'Cost centers',
  columns: [
    { key: 'code', az: 'Kod', en: 'Code', type: 'code', required: true, hintAz: 'Unikal kod.', hintEn: 'Unique code.', exampleAz: 'SAL-04', width: 12 },
    { key: 'name', az: 'Ad', en: 'Name', type: 'text', required: true, hintAz: 'Xərc mərkəzinin adı.', hintEn: 'Cost center name.', exampleAz: 'Sumqayıt filialı satış', width: 28 },
    { key: 'unitCode', az: 'Struktur vahidinin kodu', en: 'Org unit code', type: 'code', required: 'create', hintAz: 'Xərc mərkəzinin aid olduğu aktiv vahid. Büdcə bölməsi buna görə müəyyən olunur.', hintEn: 'Active unit the cost center belongs to. Determines its budget section.', exampleAz: 'SAL', width: 18 },
    { key: 'ownerEmail', az: 'Sahibin e-poçtu', en: 'Owner e-mail', type: 'email', hintAz: 'Büdcə sahibi ("XM sahibi" təsdiq mərhələsi).', hintEn: 'Budget owner (the "Cost center owner" approval step).', exampleAz: 'sales.manager@company.az', width: 26 },
    { key: 'responsibleEmail', az: 'Məsul şəxsin e-poçtu', en: 'Responsible e-mail', type: 'email', hintAz: 'Gündəlik məsul şəxs ("XM məsulu" təsdiq mərhələsi).', hintEn: 'Day-to-day responsible person (the "Cost center responsible" step).', width: 26 },
    { key: 'currency', az: 'Valyuta', en: 'Currency', type: 'enum', options: currencies, hintAz: 'Boş — şirkətin baza valyutası.', hintEn: 'Empty: the company base currency.', exampleAz: 'AZN', width: 10 },
    { key: 'validFrom', az: 'Başlama tarixi', en: 'Valid from', type: 'date', hintAz: 'İstəyə bağlı.', hintEn: 'Optional.', exampleAz: '2026-01-01', width: 14 },
    { key: 'validTo', az: 'Bitmə tarixi', en: 'Valid to', type: 'date', hintAz: 'İstəyə bağlı.', hintEn: 'Optional.', width: 14 },
    { key: 'allowedAccounts', az: 'İcazəli hesablar', en: 'Allowed accounts', type: 'list', hintAz: 'Vergüllə ayrılmış alt hesab kodları. Boş — dəyişmir (yeni XM üçün bütün hesablar). "-" — məhdudiyyəti götürür.', hintEn: 'Comma-separated postable account codes. Empty: unchanged (all accounts for a new cost center). "-" removes the restriction.', exampleAz: '711-07, 711-11', width: 30 },
    { key: 'description', az: 'Təsvir', en: 'Description', type: 'text', hintAz: 'İstəyə bağlı.', hintEn: 'Optional.', width: 26 },
    ACTIVE,
  ],
  count: (c) => get<{ n: number }>('SELECT COUNT(*) AS n FROM cost_centers WHERE company_id = ?', c)!.n,
  prefill: (c) => {
    const email = emailOf(c);
    const units = new Map(all<{ id: number; code: string }>('SELECT id, code FROM org_units WHERE company_id = ?', c).map((u) => [u.id, u.code]));
    const restr = new Map<number, string[]>();
    for (const r of all<{ cost_center_id: number; code: string }>('SELECT ca.cost_center_id, a.code FROM cost_center_accounts ca JOIN accounts a ON a.id = ca.account_id JOIN cost_centers cc ON cc.id = ca.cost_center_id WHERE cc.company_id = ? ORDER BY a.code', c)) {
      restr.set(r.cost_center_id, [...(restr.get(r.cost_center_id) ?? []), r.code]);
    }
    return all<CcRec>('SELECT * FROM cost_centers WHERE company_id = ? ORDER BY code', c).map((x) => ({
      code: x.code, name: x.name, unitCode: units.get(x.org_unit_id) ?? null, ownerEmail: email(x.owner_user_id), responsibleEmail: email(x.responsible_user_id),
      currency: x.currency, validFrom: x.valid_from, validTo: x.valid_to, allowedAccounts: restr.get(x.id)?.join(', ') ?? null, description: x.description, active: YES(x.is_active),
    }));
  },
  reference: (c) => [
    unitsRef(c),
    { nameAz: 'Alt hesablar', nameEn: 'Postable accounts', headersAz: ['Kod', 'Ad', 'Xərc sinfi'], headersEn: ['Code', 'Name', 'Expense class'], rows: all<AccRec>('SELECT * FROM accounts WHERE company_id = ? AND is_group = 0 AND is_active = 1 ORDER BY code', c).map((a) => [a.code, a.name, a.expense_class ?? '']) },
    usersRef(c),
  ],
  apply: (ctx, rows) => {
    const c = ctx.companyId;
    const base = get<{ base_currency: string }>('SELECT base_currency FROM companies WHERE id = ?', c)!.base_currency;
    const seen = new Set<string>();
    for (const r of rows) {
      const code = str(r.v.code)!;
      ctx.guard(r.row, code, () => {
        if (seen.has(code.toUpperCase())) throw badRequest('DUPLICATE_CODE', ctx.m(`"${code}" kodu faylda təkrarlanır`, `Code "${code}" is repeated in the file`));
        seen.add(code.toUpperCase());
        const unitCode = str(r.v.unitCode);
        const unit = unitCode ? unitByCode(c, unitCode) : undefined;
        if (unitCode && !unit) throw badRequest('VALIDATION_ERROR', ctx.m(`Struktur vahidi "${unitCode}" tapılmadı`, `Org unit "${unitCode}" not found`));
        if (unit && unit.is_active !== 1) throw badRequest('INVALID_HIERARCHY', ctx.m(`"${unitCode}" vahidi deaktivdir`, `Unit "${unitCode}" is inactive`));
        const owner = userRef(ctx, r, 'ownerEmail', ctx.m('Sahib', 'Owner'));
        const resp = userRef(ctx, r, 'responsibleEmail', ctx.m('Məsul şəxs', 'Responsible'));
        let accountIds: number[] | undefined;
        if (r.v.allowedAccounts === CLEAR) accountIds = [];
        else if (Array.isArray(r.v.allowedAccounts)) {
          accountIds = [];
          for (const ac of r.v.allowedAccounts) {
            const a = accByCode(c, ac);
            if (!a) throw badRequest('VALIDATION_ERROR', ctx.m(`İcazəli hesab "${ac}" tapılmadı`, `Allowed account "${ac}" not found`));
            if (a.is_group) throw badRequest('VALIDATION_ERROR', ctx.m(`"${ac}" qrup hesabıdır — yalnız alt hesablar yazılır`, `"${ac}" is a group account — list postable accounts only`));
            accountIds.push(a.id);
          }
        }
        const ex = get<CcRec>('SELECT * FROM cost_centers WHERE company_id = ? AND code = ? COLLATE NOCASE', c, code);
        const next: CcRec = ex ? { ...ex } : {
          id: 0, org_unit_id: unit?.id ?? 0, code, name: str(r.v.name)!, description: null, owner_user_id: null, responsible_user_id: null, currency: base, valid_from: null, valid_to: null, is_active: 1,
        };
        if (!ex && !unit) throw badRequest('VALIDATION_ERROR', ctx.m('Yeni xərc mərkəzi üçün "Struktur vahidinin kodu" mütləqdir', '"Org unit code" is required for a new cost center'));
        if (ex && ctx.opts.mode === 'create') { ctx.result(r.row, code, 'SKIP'); return; }
        const changes: string[] = [];
        setField(next, 'name', r.v.name, changes, ctx.m('ad', 'name'));
        if (unit) setField(next, 'org_unit_id', unit.id, changes, ctx.m('vahid', 'unit'));
        setField(next, 'owner_user_id', owner, changes, ctx.m('sahib', 'owner'));
        setField(next, 'responsible_user_id', resp, changes, ctx.m('məsul şəxs', 'responsible'));
        if (typeof r.v.currency === 'string') setField(next, 'currency', r.v.currency, changes, ctx.m('valyuta', 'currency'));
        setField(next, 'valid_from', r.v.validFrom, changes, ctx.m('başlama tarixi', 'valid from'));
        setField(next, 'valid_to', r.v.validTo, changes, ctx.m('bitmə tarixi', 'valid to'));
        setField(next, 'description', r.v.description, changes, ctx.m('təsvir', 'description'));
        if (typeof r.v.active === 'boolean') setField(next, 'is_active', +r.v.active, changes, ctx.m('aktivlik', 'active'));
        if (next.valid_from && next.valid_to && next.valid_to < next.valid_from) throw badRequest('VALIDATION_ERROR', ctx.m('Bitmə tarixi başlama tarixindən əvvəldir', 'End date is before start date'));
        const curAccounts = ex ? all<{ account_id: number }>('SELECT account_id FROM cost_center_accounts WHERE cost_center_id = ?', ex.id).map((x) => x.account_id) : [];
        const accountsChanged = accountIds !== undefined && [...new Set(accountIds)].sort().join(',') !== [...curAccounts].sort().join(',');
        if (accountsChanged) changes.push(ctx.m('icazəli hesablar', 'allowed accounts'));
        const saveAccounts = (id: number) => {
          if (!accountsChanged || !accountIds) return;
          run('DELETE FROM cost_center_accounts WHERE cost_center_id = ?', id);
          for (const a of new Set(accountIds)) run('INSERT INTO cost_center_accounts (cost_center_id, account_id) VALUES (?, ?)', id, a);
        };
        if (!ex) {
          const ts = nowIso();
          const id = Number(run(`INSERT INTO cost_centers (company_id, org_unit_id, code, name, description, owner_user_id, responsible_user_id, currency, valid_from, valid_to, is_active, created_at, updated_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            c, next.org_unit_id, code, next.name, next.description, next.owner_user_id, next.responsible_user_id, next.currency, next.valid_from, next.valid_to, next.is_active, ts, ts).lastInsertRowid);
          saveAccounts(id);
          ctx.audit('COST_CENTER', id, 'CREATED', { code, unit: unitCode });
          ctx.result(r.row, code, 'CREATE');
          return;
        }
        if (!changes.length) { ctx.result(r.row, code, 'UNCHANGED'); return; }
        run(`UPDATE cost_centers SET org_unit_id = ?, name = ?, description = ?, owner_user_id = ?, responsible_user_id = ?, currency = ?, valid_from = ?, valid_to = ?, is_active = ?, updated_at = ? WHERE id = ?`,
          next.org_unit_id, next.name, next.description, next.owner_user_id, next.responsible_user_id, next.currency, next.valid_from, next.valid_to, next.is_active, nowIso(), ex.id);
        saveAccounts(ex.id);
        ctx.audit('COST_CENTER', ex.id, 'UPDATED', { changes });
        ctx.result(r.row, code, 'UPDATE', changes);
      });
    }
  },
};

/* =================================================================== exchange rates */

const EXCHANGE_RATES: EntityDef = {
  kind: 'EXCHANGE_RATES', permission: 'coa.manage',
  titleAz: 'Valyuta məzənnələri', titleEn: 'Exchange rates',
  descriptionAz: 'Xarici valyutaların baza valyutasına məzənnəsi (məs. 1 USD = 1,70 AZN). Sorğular tarixə uyğun son məzənnə ilə çevrilir.',
  descriptionEn: 'Rates of foreign currencies to the base currency (e.g. 1 USD = 1.70 AZN). Requests use the latest rate valid on their date.',
  matchByAz: 'valyuta + tarix', matchByEn: 'currency + date', sheetAz: 'Məzənnələr', sheetEn: 'Rates',
  columns: [
    { key: 'currency', az: 'Valyuta', en: 'Currency', type: 'enum', required: true, options: (c) => { const base = get<{ base_currency: string }>('SELECT base_currency FROM companies WHERE id = ?', c)?.base_currency; return currencies().filter((x) => x !== base); }, hintAz: 'Xarici valyutanın kodu.', hintEn: 'Foreign currency code.', exampleAz: 'USD', width: 10 },
    { key: 'rate', az: 'Məzənnə', en: 'Rate', type: 'number', required: true, hintAz: '1 vahid xarici valyutanın baza valyutasında dəyəri.', hintEn: 'Value of 1 unit in the base currency.', exampleAz: '1,7', exampleEn: '1.7', width: 12 },
    { key: 'validFrom', az: 'Tarixdən etibarən', en: 'Valid from', type: 'date', required: true, hintAz: 'Məzənnənin qüvvəyə mindiyi tarix.', hintEn: 'Date from which the rate applies.', exampleAz: '2026-01-01', width: 16 },
  ],
  count: (c) => get<{ n: number }>('SELECT COUNT(*) AS n FROM exchange_rates WHERE company_id = ?', c)!.n,
  prefill: (c) => all<{ currency: string; rate: number; valid_from: string }>('SELECT * FROM exchange_rates WHERE company_id = ? ORDER BY currency, valid_from', c)
    .map((r) => ({ currency: r.currency, rate: r.rate, validFrom: r.valid_from })),
  reference: () => [{ nameAz: 'Valyutalar', nameEn: 'Currencies', headersAz: ['Kod', 'Ad'], headersEn: ['Code', 'Name'], rows: all<{ code: string; name_az: string }>('SELECT code, name_az FROM currencies ORDER BY code').map((x) => [x.code, x.name_az]) }],
  apply: (ctx, rows) => {
    const c = ctx.companyId;
    const seen = new Set<string>();
    for (const r of rows) {
      const cur = str(r.v.currency)!;
      const date = str(r.v.validFrom)!;
      const key = `${cur} ${date}`;
      ctx.guard(r.row, key, () => {
        if (seen.has(key)) throw badRequest('CONFLICT', ctx.m(`${key} faylda təkrarlanır`, `${key} is repeated in the file`));
        seen.add(key);
        const rate = r.v.rate as number;
        if (!(rate > 0 && rate < 1e6)) throw badRequest('VALIDATION_ERROR', ctx.m('Məzənnə müsbət olmalıdır', 'The rate must be positive'));
        const ex = get<{ id: number; rate: number }>('SELECT id, rate FROM exchange_rates WHERE company_id = ? AND currency = ? AND valid_from = ?', c, cur, date);
        if (!ex) {
          const id = run('INSERT INTO exchange_rates (company_id, currency, rate, valid_from, created_at) VALUES (?, ?, ?, ?, ?)', c, cur, rate, date, nowIso()).lastInsertRowid;
          ctx.audit('EXCHANGE_RATE', id, 'SAVED', { currency: cur, rate, validFrom: date });
          ctx.result(r.row, key, 'CREATE');
          return;
        }
        if (ctx.opts.mode === 'create') { ctx.result(r.row, key, 'SKIP'); return; }
        if (Math.abs(ex.rate - rate) < 1e-9) { ctx.result(r.row, key, 'UNCHANGED'); return; }
        run('UPDATE exchange_rates SET rate = ? WHERE id = ?', rate, ex.id);
        ctx.audit('EXCHANGE_RATE', ex.id, 'SAVED', { currency: cur, rate: [ex.rate, rate], validFrom: date });
        ctx.result(r.row, key, 'UPDATE', [ctx.m('məzənnə', 'rate')]);
      });
    }
  },
};

export const ENTITIES: Record<BulkImportKind, EntityDef> = { ORG_UNITS, JOB_FAMILIES, USERS, POSITIONS, ACCOUNTS, COST_CENTERS, EXCHANGE_RATES };
