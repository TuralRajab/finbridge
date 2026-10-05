/**
 * Industry templates (global reference data, synced into `industry_templates` / `template_accounts` at startup).
 *
 * Commercial templates follow the Azerbaijani national chart of accounts for commercial organisations:
 * synthetic accounts 601 (Satış), 611 (Sair əməliyyat gəlirləri), 701 (Satışın maya dəyəri), 711 (Kommersiya xərcləri),
 * 721 (İnzibati xərclər), 731 (Sair əməliyyat xərcləri), 751 (Maliyyə xərcləri), 111 (Qeyri-maddi aktivlər) and
 * 113 (Torpaq, tikili və avadanlıqlar) are the groups; management sub-accounts (e.g. 721-01) are the budgeting leaves.
 * Banks use the CBAR chart of accounts for statutory books, so the banking template is a management (FP&A) chart.
 * Every template is a starting point: companies review, rename, deactivate and extend it.
 */
import type { AccountType, ExpenseClass, TemplateAccountDto, TemplateContent, TemplateWorkflow } from '@finbridge/shared';

export interface TemplateDef {
  code: string;
  nameAz: string;
  nameEn: string;
  descriptionAz: string;
  descriptionEn: string;
  version: number;
  accounts: TemplateAccountDto[];
  content: TemplateContent;
}

type Row = [code: string, parent: string | null, az: string, en: string, category?: string | null];

/** Builds accounts: rows with parent === null are top-level groups; groups are rows that have children. */
function chart(rows: Row[], types: Record<string, { type: AccountType; cls: ExpenseClass | null }>): TemplateAccountDto[] {
  const parents = new Set(rows.map((r) => r[1]).filter(Boolean) as string[]);
  const byCode = new Map(rows.map((r) => [r[0], r]));
  const top = (code: string): string => {
    let cur = byCode.get(code);
    while (cur && cur[1]) cur = byCode.get(cur[1]);
    return cur ? cur[0] : code;
  };
  return rows.map(([code, parent, az, en, category]) => {
    const t = types[top(code)] ?? { type: 'EXPENSE', cls: 'OPEX' };
    return {
      code, parentCode: parent, nameAz: az, nameEn: en, accountType: t.type,
      category: category ?? null, expenseClass: parent === null ? t.cls : null, isGroup: parents.has(code),
    };
  });
}

const COMMERCIAL_TYPES = {
  '6': { type: 'REVENUE' as const, cls: null },
  '7': { type: 'EXPENSE' as const, cls: 'OPEX' as const },
  '1': { type: 'CAPEX' as const, cls: 'CAPEX' as const },
};

const HEAD: Row[] = [
  ['6', null, 'GƏLİRLƏR', 'INCOME'],
  ['601', '6', 'Satış', 'Sales revenue'],
  ['611', '6', 'Sair əməliyyat gəlirləri', 'Other operating income'],
  ['7', null, 'ƏMƏLİYYAT XƏRCLƏRİ', 'OPERATING EXPENSES'],
  ['701', '7', 'Satışın maya dəyəri', 'Cost of sales'],
  ['711', '7', 'Kommersiya xərcləri', 'Selling and distribution expenses'],
  ['721', '7', 'İnzibati xərclər', 'Administrative expenses'],
  ['731', '7', 'Sair əməliyyat xərcləri', 'Other operating expenses'],
  ['751', '7', 'Maliyyə xərcləri', 'Finance costs'],
  ['1', null, 'KAPİTAL XƏRCLƏRİ (CAPEX)', 'CAPITAL EXPENDITURE (CAPEX)'],
  ['111', '1', 'Qeyri-maddi aktivlər', 'Intangible assets'],
  ['113', '1', 'Torpaq, tikili və avadanlıqlar', 'Property, plant and equipment'],
];

/** Administrative block shared by commercial templates (721-01 … 721-08). */
const ADMIN: Row[] = [
  ['721-01', '721', 'İnzibati heyətin əmək haqqı', 'Administrative staff salaries', 'Personnel'],
  ['721-02', '721', 'DSMF-ə məcburi sosial sığorta ayırmaları', 'Social insurance contributions (DSMF)', 'Personnel'],
  ['721-03', '721', 'Tibbi sığorta və digər müavinətlər', 'Medical insurance and benefits', 'Personnel'],
  ['721-04', '721', 'Təlim və inkişaf', 'Training and development', 'Personnel'],
  ['721-05', '721', 'Ofis icarəsi', 'Office rent', 'Premises'],
  ['721-06', '721', 'Kommunal xərclər', 'Utilities', 'Premises'],
  ['721-07', '721', 'Proqram təminatı və lisenziyalar', 'Software and licences', 'IT'],
  ['721-08', '721', 'İT xidmətləri və rabitə', 'IT services and telecommunications', 'IT'],
];

const UNITS_BASE = [
  { code: 'EXEC', type: 'EXECUTIVE', parent: null, nameAz: 'İcra rəhbərliyi', nameEn: 'Executive management' },
  { code: 'FIN', type: 'DEPARTMENT', parent: 'EXEC', nameAz: 'Maliyyə', nameEn: 'Finance' },
];

const JOB_FAMILIES = [
  { code: 'HR', nameAz: 'İnsan resursları', nameEn: 'Human Resources' },
  { code: 'FIN', nameAz: 'Maliyyə', nameEn: 'Finance' },
  { code: 'IT', nameAz: 'İnformasiya texnologiyaları', nameEn: 'Information Technology' },
];

/** Suggested workflows — loaded into the company, then freely editable in the workflow builder. */
export const DEFAULT_WORKFLOWS: TemplateWorkflow[] = [
  {
    name: 'Departament büdcəsinin təqdimatı', type: 'BUDGET_SUBMISSION', priority: 100, conditions: null,
    steps: [
      { name: 'Departament rəhbəri', approverType: 'DEPARTMENT_HEAD', slaHours: 48 },
      { name: 'Maliyyə meneceri', approverType: 'FINANCE_MANAGER', slaHours: 72 },
    ],
  },
  {
    name: 'HR illik büdcə təsdiqi', type: 'BUDGET_SUBMISSION', priority: 10,
    conditions: { all: [{ field: 'department', op: 'in', value: ['HR'] }] },
    steps: [
      { name: 'HR xərc mərkəzi məsulu', approverType: 'COST_CENTER_RESPONSIBLE', slaHours: 48 },
      { name: 'HR job family sahibi', approverType: 'JOB_FAMILY_OWNER', config: { jobFamilyCode: 'HR' }, slaHours: 48 },
      { name: 'Maliyyə meneceri', approverType: 'FINANCE_MANAGER', slaHours: 72 },
      { name: 'CFO', approverType: 'CFO', slaHours: 72 },
      { name: 'CEO', approverType: 'CEO', slaHours: 72 },
    ],
  },
  {
    name: 'İllik büdcənin təsdiqi', type: 'BUDGET_APPROVAL', priority: 100, conditions: null,
    steps: [
      { name: 'CFO', approverType: 'CFO', slaHours: 72 },
      { name: 'CEO', approverType: 'CEO', slaHours: 72 },
    ],
  },
  {
    name: 'Büdcə dəyişikliyi sorğusu', type: 'BUDGET_CHANGE', priority: 100, conditions: null,
    steps: [
      { name: 'Xərc mərkəzinin sahibi', approverType: 'COST_CENTER_OWNER', slaHours: 48 },
      { name: 'Maliyyə meneceri', approverType: 'FINANCE_MANAGER', slaHours: 48 },
      { name: 'CFO', approverType: 'CFO', slaHours: 72, condition: { all: [{ field: 'amount', op: 'gte', value: 10000 }] } },
      { name: 'CEO', approverType: 'CEO', slaHours: 72, condition: { all: [{ field: 'amount', op: 'gte', value: 100000 }] } },
    ],
  },
  {
    name: 'Satınalma sorğusu (OPEX)', type: 'PURCHASE_REQUEST', priority: 100, conditions: null,
    steps: [
      { name: 'Xərc mərkəzinin sahibi', approverType: 'COST_CENTER_OWNER', slaHours: 24 },
      { name: 'Maliyyə meneceri', approverType: 'FINANCE_MANAGER', slaHours: 48, condition: { all: [{ field: 'amount', op: 'gte', value: 10000 }] } },
      { name: 'CFO', approverType: 'CFO', slaHours: 48, condition: { all: [{ field: 'amount', op: 'gte', value: 100000 }] } },
      { name: 'CEO', approverType: 'CEO', slaHours: 72, condition: { all: [{ field: 'amount', op: 'gte', value: 500000 }] } },
    ],
  },
  {
    name: 'CAPEX satınalma sorğusu', type: 'PURCHASE_REQUEST', priority: 50,
    conditions: { all: [{ field: 'expenseClass', op: 'eq', value: 'CAPEX' }] },
    steps: [
      { name: 'Xərc mərkəzinin sahibi', approverType: 'COST_CENTER_OWNER', slaHours: 24 },
      { name: 'Divizion rəhbəri', approverType: 'EXECUTIVE', slaHours: 48 },
      { name: 'Maliyyə meneceri', approverType: 'FINANCE_MANAGER', slaHours: 48 },
      { name: 'CFO', approverType: 'CFO', slaHours: 72 },
      { name: 'CEO', approverType: 'CEO', slaHours: 72, condition: { all: [{ field: 'amount', op: 'gte', value: 100000 }] } },
    ],
  },
  {
    name: 'Xərc sorğusu (ezamiyyə, təmsilçilik)', type: 'EXPENSE_REQUEST', priority: 100, conditions: null,
    steps: [
      { name: 'Birbaşa rəhbər', approverType: 'DYNAMIC_MANAGER', slaHours: 24 },
      { name: 'Xərc mərkəzinin sahibi', approverType: 'COST_CENTER_OWNER', slaHours: 24 },
      { name: 'Maliyyə meneceri', approverType: 'FINANCE_MANAGER', slaHours: 48, condition: { all: [{ field: 'amount', op: 'gte', value: 5000 }] } },
    ],
  },
];

const COMMON_KPIS = [
  { code: 'CONSUMPTION', nameAz: 'Büdcənin istifadəsi', nameEn: 'Budget consumption', formulaAz: '(Fakt + Öhdəlik) / Büdcə', formulaEn: '(Actual + Committed) / Budget' },
  { code: 'OPEX_REV', nameAz: 'Əməliyyat xərclərinin gəlirə nisbəti', nameEn: 'OPEX to revenue', formulaAz: '7 qrupu / 601', formulaEn: 'Group 7 / account 601' },
];

const COMMON_ASSUMPTIONS_AZ = [
  'Əmək haqqı artımı faizini şirkətin kadr siyasətinə uyğun müəyyən edin.',
  'Xarici valyuta ilə alışlar üçün planlaşdırma məzənnəsini "Valyutalar" bölməsində təyin edin.',
  'CAPEX layihələrini ayrıca xərc mərkəzində planlaşdırın ki, amortizasiya təsiri izlənilsin.',
];
const COMMON_ASSUMPTIONS_EN = [
  'Set the salary increase rate according to the company HR policy.',
  'Define the planning exchange rate for foreign-currency purchases under Currencies.',
  'Plan CAPEX projects on dedicated cost centers so that the depreciation effect can be tracked.',
];

function content(partial: Partial<TemplateContent> & Pick<TemplateContent, 'units' | 'costCenters'>): TemplateContent {
  return {
    budgetingTypes: ['DEPARTMENT'],
    jobFamilies: JOB_FAMILIES,
    workflows: DEFAULT_WORKFLOWS,
    kpis: COMMON_KPIS,
    assumptionsAz: COMMON_ASSUMPTIONS_AZ,
    assumptionsEn: COMMON_ASSUMPTIONS_EN,
    ...partial,
  };
}

/* ===================================================================== Sales & Distribution */

const SALES_DISTRIBUTION: TemplateDef = {
  code: 'SALES_DISTRIBUTION',
  nameAz: 'Satış və distribusiya',
  nameEn: 'Sales & Distribution',
  descriptionAz: 'Topdan və pərakəndə ticarət, distribusiya şirkətləri: satış filialları, logistika, anbar, ticarət marketinqi.',
  descriptionEn: 'Wholesale, retail and distribution companies: sales branches, logistics, warehousing, trade marketing.',
  version: 1,
  accounts: chart([
    ...HEAD,
    ['601-01', '601', 'Topdan satış gəlirləri', 'Wholesale revenue', 'Revenue'],
    ['601-02', '601', 'Pərakəndə satış gəlirləri', 'Retail revenue', 'Revenue'],
    ['601-03', '601', 'Distribusiya xidməti gəlirləri', 'Distribution service revenue', 'Revenue'],
    ['601-04', '601', 'Satış endirimləri və qaytarmalar', 'Sales discounts and returns', 'Revenue'],
    ['611-01', '611', 'Təchizatçı bonusları və retrobonuslar', 'Supplier rebates and bonuses', 'Revenue'],
    ['611-02', '611', 'Təchizatçıların marketinq kompensasiyaları', 'Marketing reimbursements from suppliers', 'Revenue'],
    ['701-01', '701', 'Satış üçün alınmış malların dəyəri', 'Cost of goods purchased for resale', 'Cost of sales'],
    ['701-02', '701', 'Gömrük rüsumları və idxal xərcləri', 'Customs duties and import costs', 'Cost of sales'],
    ['701-03', '701', 'Malların gətirilməsi (daxili daşıma)', 'Inbound freight', 'Cost of sales'],
    ['711-01', '711', 'Satış heyətinin əmək haqqı', 'Sales staff salaries', 'Personnel'],
    ['711-02', '711', 'Satış bonusları və komissiyaları', 'Sales bonuses and commissions', 'Personnel'],
    ['711-03', '711', 'Reklam', 'Advertising', 'Marketing'],
    ['711-04', '711', 'Ticarət marketinqi və merçendayzinq', 'Trade marketing and merchandising', 'Marketing'],
    ['711-05', '711', 'Sərgilər və tədbirlər', 'Trade shows and events', 'Marketing'],
    ['711-06', '711', 'Müştərilərə çatdırılma xərcləri', 'Outbound delivery costs', 'Logistics'],
    ['711-07', '711', 'Yanacaq', 'Fuel', 'Logistics'],
    ['711-08', '711', 'Avtoparkın təmiri və sığortası', 'Fleet maintenance and insurance', 'Logistics'],
    ['711-09', '711', 'Anbar icarəsi', 'Warehouse rent', 'Warehouse'],
    ['711-10', '711', 'Anbar xidmətləri və qablaşdırma', 'Warehouse handling and packaging', 'Warehouse'],
    ['711-11', '711', 'Ezamiyyə xərcləri', 'Business travel', 'Travel'],
    ...ADMIN,
    ['721-09', '721', 'Audit və məsləhət xidmətləri', 'Audit and consulting services', 'Professional services'],
    ['721-10', '721', 'Hüquqi xidmətlər', 'Legal services', 'Professional services'],
    ['721-11', '721', 'Bank xidmət haqları', 'Bank charges', 'Finance'],
    ['721-12', '721', 'Ofis ləvazimatları', 'Office supplies', 'Office'],
    ['731-01', '731', 'Şübhəli debitor borcları üzrə ehtiyat', 'Provision for doubtful receivables', 'Other'],
    ['731-02', '731', 'Malların itkisi və silinməsi', 'Inventory shrinkage and write-offs', 'Other'],
    ['731-03', '731', 'Amortizasiya', 'Depreciation', 'Depreciation'],
    ['751-01', '751', 'Kreditlər üzrə faiz xərcləri', 'Interest on loans', 'Finance'],
    ['751-02', '751', 'Məzənnə fərqi zərərləri', 'Foreign exchange losses', 'Finance'],
    ['111-01', '111', 'ERP və proqram təminatı', 'ERP and software licences', 'IT'],
    ['113-01', '113', 'Nəqliyyat vasitələri', 'Vehicles', 'Fleet'],
    ['113-02', '113', 'Anbar avadanlığı', 'Warehouse equipment', 'Warehouse'],
    ['113-03', '113', 'Kompüter və İT avadanlığı', 'Computers and IT equipment', 'IT'],
    ['113-04', '113', 'Ofis mebeli və təmiri', 'Office furniture and fit-out', 'Premises'],
  ], COMMERCIAL_TYPES),
  content: content({
    units: [
      ...UNITS_BASE,
      { code: 'COM', type: 'DIVISION', parent: null, nameAz: 'Kommersiya', nameEn: 'Commercial' },
      { code: 'SAL', type: 'DEPARTMENT', parent: 'COM', nameAz: 'Satış', nameEn: 'Sales' },
      { code: 'BR-BAK', type: 'BRANCH', parent: 'SAL', nameAz: 'Bakı filialı', nameEn: 'Baku branch' },
      { code: 'BR-GNC', type: 'BRANCH', parent: 'SAL', nameAz: 'Gəncə filialı', nameEn: 'Ganja branch' },
      { code: 'MKT', type: 'DEPARTMENT', parent: 'COM', nameAz: 'Marketinq', nameEn: 'Marketing' },
      { code: 'OPD', type: 'DIVISION', parent: null, nameAz: 'Əməliyyatlar', nameEn: 'Operations' },
      { code: 'LOG', type: 'DEPARTMENT', parent: 'OPD', nameAz: 'Logistika', nameEn: 'Logistics' },
      { code: 'WH', type: 'DEPARTMENT', parent: 'OPD', nameAz: 'Anbar', nameEn: 'Warehouse' },
      { code: 'SUP', type: 'DIVISION', parent: null, nameAz: 'Dəstək funksiyaları', nameEn: 'Support functions' },
      { code: 'HR', type: 'DEPARTMENT', parent: 'SUP', nameAz: 'İnsan resursları', nameEn: 'Human resources' },
      { code: 'IT', type: 'DEPARTMENT', parent: 'SUP', nameAz: 'İnformasiya texnologiyaları', nameEn: 'Information technology' },
    ],
    costCenters: [
      { code: 'EXE-01', unit: 'EXEC', nameAz: 'Rəhbərlik', nameEn: 'Management' },
      { code: 'FIN-01', unit: 'FIN', nameAz: 'Maliyyə və mühasibatlıq', nameEn: 'Finance and accounting' },
      { code: 'SAL-01', unit: 'BR-BAK', nameAz: 'Sahə satışları — Bakı', nameEn: 'Field sales — Baku' },
      { code: 'SAL-02', unit: 'BR-GNC', nameAz: 'Sahə satışları — Gəncə', nameEn: 'Field sales — Ganja' },
      { code: 'SAL-03', unit: 'SAL', nameAz: 'Əsas müştərilər (KAM)', nameEn: 'Key accounts' },
      { code: 'MKT-01', unit: 'MKT', nameAz: 'Rəqəmsal marketinq', nameEn: 'Digital marketing' },
      { code: 'MKT-02', unit: 'MKT', nameAz: 'Tədbirlər və ticarət marketinqi', nameEn: 'Events and trade marketing' },
      { code: 'LOG-01', unit: 'LOG', nameAz: 'Çatdırılma', nameEn: 'Delivery' },
      { code: 'LOG-02', unit: 'LOG', nameAz: 'Avtopark', nameEn: 'Fleet' },
      { code: 'WH-01', unit: 'WH', nameAz: 'Mərkəzi anbar', nameEn: 'Central warehouse' },
      { code: 'HR-01', unit: 'HR', nameAz: 'İşə qəbul', nameEn: 'Recruitment' },
      { code: 'HR-02', unit: 'HR', nameAz: 'Təlim və inkişaf', nameEn: 'Learning and development' },
      { code: 'HR-03', unit: 'HR', nameAz: 'Kompensasiya və müavinətlər', nameEn: 'Compensation and benefits' },
      { code: 'IT-01', unit: 'IT', nameAz: 'İnfrastruktur', nameEn: 'Infrastructure' },
      { code: 'IT-02', unit: 'IT', nameAz: 'Proqram təminatı', nameEn: 'Software' },
    ],
    kpis: [
      ...COMMON_KPIS,
      { code: 'GM', nameAz: 'Ümumi mənfəət marjası', nameEn: 'Gross margin', formulaAz: '(601 − 701) / 601', formulaEn: '(601 − 701) / 601' },
      { code: 'LOG_REV', nameAz: 'Logistika xərclərinin satışa nisbəti', nameEn: 'Logistics cost to sales', formulaAz: '(711-06 + 711-07 + 711-08) / 601', formulaEn: '(711-06 + 711-07 + 711-08) / 601' },
    ],
  }),
};

/* ===================================================================== Manufacturing */

const MANUFACTURING: TemplateDef = {
  code: 'MANUFACTURING',
  nameAz: 'İstehsalat',
  nameEn: 'Manufacturing',
  descriptionAz: 'Qida, tikinti materialları, qablaşdırma və digər istehsal müəssisələri: istehsal xətləri, texniki xidmət, keyfiyyət, təchizat.',
  descriptionEn: 'Food, building materials, packaging and other manufacturers: production lines, maintenance, quality, supply chain.',
  version: 1,
  accounts: chart([
    ...HEAD,
    ['601-01', '601', 'Hazır məhsulun yerli satışı', 'Domestic sales of finished goods', 'Revenue'],
    ['601-02', '601', 'İxrac satışları', 'Export sales', 'Revenue'],
    ['601-03', '601', 'Yarımfabrikat və tullantı satışı', 'Sales of by-products and scrap', 'Revenue'],
    ['611-01', '611', 'Sair əməliyyat gəlirləri', 'Other operating income', 'Revenue'],
    ['701-01', '701', 'Xammal və əsas materiallar', 'Raw materials', 'Materials'],
    ['701-02', '701', 'Qablaşdırma materialları', 'Packaging materials', 'Materials'],
    ['701-03', '701', 'Birbaşa əmək haqqı (istehsal işçiləri)', 'Direct labour', 'Personnel'],
    ['701-04', '701', 'İstehsalat enerjisi (elektrik, qaz)', 'Production energy (electricity, gas)', 'Utilities'],
    ['701-05', '701', 'Su və digər istehsalat kommunalları', 'Water and other production utilities', 'Utilities'],
    ['701-06', '701', 'Avadanlığın təmiri və texniki xidməti', 'Machinery repair and maintenance', 'Maintenance'],
    ['701-07', '701', 'Ehtiyat hissələri', 'Spare parts', 'Maintenance'],
    ['701-08', '701', 'Keyfiyyətə nəzarət və laboratoriya', 'Quality control and laboratory', 'Quality'],
    ['701-09', '701', 'Ümumi istehsalat xərcləri', 'Production overhead', 'Overhead'],
    ['701-10', '701', 'İstehsalat aktivlərinin amortizasiyası', 'Depreciation of production assets', 'Depreciation'],
    ['701-11', '701', 'Əməyin mühafizəsi və xüsusi geyim', 'Health & safety and workwear', 'HSE'],
    ['711-01', '711', 'Satış heyətinin əmək haqqı', 'Sales staff salaries', 'Personnel'],
    ['711-02', '711', 'Reklam və marketinq', 'Advertising and marketing', 'Marketing'],
    ['711-03', '711', 'Hazır məhsulun daşınması', 'Finished goods freight', 'Logistics'],
    ['711-04', '711', 'Anbar xərcləri', 'Warehouse costs', 'Warehouse'],
    ['711-05', '711', 'Distribütor bonusları', 'Distributor incentives', 'Sales'],
    ['711-06', '711', 'Sertifikatlaşdırma və sərgilər', 'Certification and exhibitions', 'Marketing'],
    ...ADMIN,
    ['721-09', '721', 'Audit və məsləhət xidmətləri', 'Audit and consulting services', 'Professional services'],
    ['721-10', '721', 'Ezamiyyə xərcləri', 'Business travel', 'Travel'],
    ['721-11', '721', 'Əmlak sığortası', 'Property insurance', 'Insurance'],
    ['731-01', '731', 'Ekoloji ödənişlər', 'Environmental fees', 'Compliance'],
    ['731-02', '731', 'Zay məhsul və istehsalat itkiləri', 'Scrap and production losses', 'Other'],
    ['751-01', '751', 'Kreditlər üzrə faiz xərcləri', 'Interest on loans', 'Finance'],
    ['751-02', '751', 'Məzənnə fərqi zərərləri', 'Foreign exchange losses', 'Finance'],
    ['111-01', '111', 'ERP/MES proqram təminatı', 'ERP / MES software', 'IT'],
    ['113-01', '113', 'İstehsalat avadanlığı və maşınlar', 'Production machinery and equipment', 'Machinery'],
    ['113-02', '113', 'İstehsalat binaları və qurğular', 'Production buildings and structures', 'Buildings'],
    ['113-03', '113', 'Nəqliyyat və yükləmə texnikası', 'Vehicles and forklifts', 'Fleet'],
    ['113-04', '113', 'İT avadanlığı', 'IT equipment', 'IT'],
  ], COMMERCIAL_TYPES),
  content: content({
    units: [
      ...UNITS_BASE,
      { code: 'PRD', type: 'DIVISION', parent: null, nameAz: 'İstehsalat', nameEn: 'Production' },
      { code: 'PRO', type: 'DEPARTMENT', parent: 'PRD', nameAz: 'İstehsal', nameEn: 'Manufacturing operations' },
      { code: 'LINE-1', type: 'TEAM', parent: 'PRO', nameAz: 'İstehsal xətti 1', nameEn: 'Production line 1' },
      { code: 'LINE-2', type: 'TEAM', parent: 'PRO', nameAz: 'İstehsal xətti 2', nameEn: 'Production line 2' },
      { code: 'MNT', type: 'DEPARTMENT', parent: 'PRD', nameAz: 'Texniki xidmət', nameEn: 'Maintenance' },
      { code: 'QC', type: 'DEPARTMENT', parent: 'PRD', nameAz: 'Keyfiyyətə nəzarət', nameEn: 'Quality control' },
      { code: 'SCM', type: 'DIVISION', parent: null, nameAz: 'Təchizat zənciri', nameEn: 'Supply chain' },
      { code: 'PUR', type: 'DEPARTMENT', parent: 'SCM', nameAz: 'Satınalma', nameEn: 'Procurement' },
      { code: 'WH', type: 'DEPARTMENT', parent: 'SCM', nameAz: 'Anbar və logistika', nameEn: 'Warehouse and logistics' },
      { code: 'COM', type: 'DIVISION', parent: null, nameAz: 'Kommersiya', nameEn: 'Commercial' },
      { code: 'SAL', type: 'DEPARTMENT', parent: 'COM', nameAz: 'Satış və ixrac', nameEn: 'Sales and export' },
      { code: 'MKT', type: 'DEPARTMENT', parent: 'COM', nameAz: 'Marketinq', nameEn: 'Marketing' },
      { code: 'SUP', type: 'DIVISION', parent: null, nameAz: 'Dəstək funksiyaları', nameEn: 'Support functions' },
      { code: 'HR', type: 'DEPARTMENT', parent: 'SUP', nameAz: 'İnsan resursları', nameEn: 'Human resources' },
      { code: 'IT', type: 'DEPARTMENT', parent: 'SUP', nameAz: 'İnformasiya texnologiyaları', nameEn: 'Information technology' },
    ],
    costCenters: [
      { code: 'FIN-01', unit: 'FIN', nameAz: 'Maliyyə və mühasibatlıq', nameEn: 'Finance and accounting' },
      { code: 'PRD-01', unit: 'LINE-1', nameAz: 'İstehsal xətti 1', nameEn: 'Production line 1' },
      { code: 'PRD-02', unit: 'LINE-2', nameAz: 'İstehsal xətti 2', nameEn: 'Production line 2' },
      { code: 'PRD-09', unit: 'PRO', nameAz: 'Kapital layihələri', nameEn: 'Capital projects' },
      { code: 'MNT-01', unit: 'MNT', nameAz: 'Texniki xidmət', nameEn: 'Maintenance' },
      { code: 'QC-01', unit: 'QC', nameAz: 'Laboratoriya', nameEn: 'Laboratory' },
      { code: 'PUR-01', unit: 'PUR', nameAz: 'Satınalma', nameEn: 'Procurement' },
      { code: 'WH-01', unit: 'WH', nameAz: 'Xammal anbarı', nameEn: 'Raw material warehouse' },
      { code: 'WH-02', unit: 'WH', nameAz: 'Hazır məhsul anbarı', nameEn: 'Finished goods warehouse' },
      { code: 'SAL-01', unit: 'SAL', nameAz: 'Yerli satış', nameEn: 'Domestic sales' },
      { code: 'SAL-02', unit: 'SAL', nameAz: 'İxrac', nameEn: 'Export' },
      { code: 'MKT-01', unit: 'MKT', nameAz: 'Marketinq', nameEn: 'Marketing' },
      { code: 'HR-01', unit: 'HR', nameAz: 'İnsan resursları', nameEn: 'Human resources' },
      { code: 'IT-01', unit: 'IT', nameAz: 'İT', nameEn: 'IT' },
    ],
    kpis: [
      ...COMMON_KPIS,
      { code: 'MAT_REV', nameAz: 'Material xərclərinin satışa nisbəti', nameEn: 'Material cost to sales', formulaAz: '(701-01 + 701-02) / 601', formulaEn: '(701-01 + 701-02) / 601' },
      { code: 'MNT_COST', nameAz: 'Texniki xidmət xərcləri', nameEn: 'Maintenance spend', formulaAz: '701-06 + 701-07', formulaEn: '701-06 + 701-07' },
    ],
  }),
};

/* ===================================================================== Industry (heavy industry, construction, energy services) */

const INDUSTRY: TemplateDef = {
  code: 'INDUSTRY',
  nameAz: 'Sənaye və tikinti',
  nameEn: 'Industry & Construction',
  descriptionAz: 'Tikinti, enerji xidmətləri, metal emalı və layihə əsaslı sənaye şirkətləri: sahələr, ağır texnika, podratçılar, HSE.',
  descriptionEn: 'Construction, energy services, metal works and project-based industrial companies: sites, heavy equipment, subcontractors, HSE.',
  version: 1,
  accounts: chart([
    ...HEAD,
    ['601-01', '601', 'Məhsul satışı', 'Product sales', 'Revenue'],
    ['601-02', '601', 'Tikinti-quraşdırma işləri üzrə gəlir', 'Construction and installation revenue', 'Revenue'],
    ['601-03', '601', 'Texniki xidmət gəlirləri', 'Service and maintenance revenue', 'Revenue'],
    ['611-01', '611', 'Avadanlığın icarəsindən gəlir', 'Equipment rental income', 'Revenue'],
    ['701-01', '701', 'Əsas materiallar və metal', 'Primary materials and metals', 'Materials'],
    ['701-02', '701', 'Tikinti materialları', 'Construction materials', 'Materials'],
    ['701-03', '701', 'Yanacaq və sürtkü materialları', 'Fuel and lubricants', 'Energy'],
    ['701-04', '701', 'Elektrik enerjisi', 'Electricity', 'Energy'],
    ['701-05', '701', 'Podratçı xidmətləri', 'Subcontractor services', 'Subcontracting'],
    ['701-06', '701', 'Ağır texnikanın icarəsi', 'Heavy equipment rental', 'Equipment'],
    ['701-07', '701', 'Birbaşa əmək haqqı (sahə işçiləri)', 'Direct labour (site workers)', 'Personnel'],
    ['701-08', '701', 'Texnikanın təmiri və texniki xidməti', 'Equipment repair and maintenance', 'Maintenance'],
    ['701-09', '701', 'Əməyin mühafizəsi və təhlükəsizlik (HSE)', 'Health, safety and environment (HSE)', 'HSE'],
    ['701-10', '701', 'Sahə ümumi xərcləri', 'Site overheads', 'Overhead'],
    ['711-01', '711', 'Satış və tender xərcləri', 'Sales and tender costs', 'Sales'],
    ['711-02', '711', 'Logistika və daşıma', 'Logistics and transport', 'Logistics'],
    ['711-03', '711', 'Marketinq', 'Marketing', 'Marketing'],
    ...ADMIN,
    ['721-09', '721', 'Audit və məsləhət xidmətləri', 'Audit and consulting services', 'Professional services'],
    ['721-10', '721', 'Ezamiyyə xərcləri', 'Business travel', 'Travel'],
    ['721-11', '721', 'Lisenziya və icazələr', 'Permits and licences', 'Compliance'],
    ['731-01', '731', 'Ekoloji ödənişlər', 'Environmental fees', 'Compliance'],
    ['731-02', '731', 'Cərimə və penyalar', 'Fines and penalties', 'Other'],
    ['731-03', '731', 'Amortizasiya', 'Depreciation', 'Depreciation'],
    ['751-01', '751', 'Kreditlər üzrə faiz xərcləri', 'Interest on loans', 'Finance'],
    ['751-02', '751', 'Məzənnə fərqi zərərləri', 'Foreign exchange losses', 'Finance'],
    ['751-03', '751', 'Bank zəmanəti haqları', 'Bank guarantee fees', 'Finance'],
    ['111-01', '111', 'Mühəndislik proqram təminatı', 'Engineering software', 'IT'],
    ['113-01', '113', 'Ağır texnika və avadanlıq', 'Heavy machinery and equipment', 'Machinery'],
    ['113-02', '113', 'Binalar və qurğular', 'Buildings and structures', 'Buildings'],
    ['113-03', '113', 'Nəqliyyat vasitələri', 'Vehicles', 'Fleet'],
    ['113-04', '113', 'İT avadanlığı', 'IT equipment', 'IT'],
  ], COMMERCIAL_TYPES),
  content: content({
    units: [
      ...UNITS_BASE,
      { code: 'PRJ', type: 'DIVISION', parent: null, nameAz: 'Layihələr', nameEn: 'Projects' },
      { code: 'SITE', type: 'DEPARTMENT', parent: 'PRJ', nameAz: 'Tikinti sahələri', nameEn: 'Construction sites' },
      { code: 'SITE-1', type: 'BRANCH', parent: 'SITE', nameAz: 'Sahə 1 — Sumqayıt', nameEn: 'Site 1 — Sumgait' },
      { code: 'SITE-2', type: 'BRANCH', parent: 'SITE', nameAz: 'Sahə 2 — Bakı', nameEn: 'Site 2 — Baku' },
      { code: 'ENG', type: 'DEPARTMENT', parent: 'PRJ', nameAz: 'Mühəndislik', nameEn: 'Engineering' },
      { code: 'EQP', type: 'DEPARTMENT', parent: 'PRJ', nameAz: 'Texnika və avadanlıq', nameEn: 'Plant and equipment' },
      { code: 'HSE', type: 'DEPARTMENT', parent: 'PRJ', nameAz: 'Əməyin mühafizəsi (HSE)', nameEn: 'HSE' },
      { code: 'COM', type: 'DIVISION', parent: null, nameAz: 'Kommersiya', nameEn: 'Commercial' },
      { code: 'PROC', type: 'DEPARTMENT', parent: 'COM', nameAz: 'Satınalma', nameEn: 'Procurement' },
      { code: 'SAL', type: 'DEPARTMENT', parent: 'COM', nameAz: 'Satış və tenderlər', nameEn: 'Sales and tenders' },
      { code: 'SUP', type: 'DIVISION', parent: null, nameAz: 'Dəstək funksiyaları', nameEn: 'Support functions' },
      { code: 'HR', type: 'DEPARTMENT', parent: 'SUP', nameAz: 'İnsan resursları', nameEn: 'Human resources' },
      { code: 'IT', type: 'DEPARTMENT', parent: 'SUP', nameAz: 'İnformasiya texnologiyaları', nameEn: 'Information technology' },
    ],
    costCenters: [
      { code: 'FIN-01', unit: 'FIN', nameAz: 'Maliyyə', nameEn: 'Finance' },
      { code: 'ST1-01', unit: 'SITE-1', nameAz: 'Sahə 1 — işlər', nameEn: 'Site 1 — works' },
      { code: 'ST2-01', unit: 'SITE-2', nameAz: 'Sahə 2 — işlər', nameEn: 'Site 2 — works' },
      { code: 'ENG-01', unit: 'ENG', nameAz: 'Layihələndirmə', nameEn: 'Design' },
      { code: 'EQP-01', unit: 'EQP', nameAz: 'Texnika parkı', nameEn: 'Equipment fleet' },
      { code: 'HSE-01', unit: 'HSE', nameAz: 'HSE', nameEn: 'HSE' },
      { code: 'PRC-01', unit: 'PROC', nameAz: 'Satınalma', nameEn: 'Procurement' },
      { code: 'SAL-01', unit: 'SAL', nameAz: 'Tenderlər', nameEn: 'Tenders' },
      { code: 'HR-01', unit: 'HR', nameAz: 'İnsan resursları', nameEn: 'Human resources' },
      { code: 'IT-01', unit: 'IT', nameAz: 'İT', nameEn: 'IT' },
    ],
    kpis: [
      ...COMMON_KPIS,
      { code: 'SUBC', nameAz: 'Podratçı xərclərinin payı', nameEn: 'Subcontracting share', formulaAz: '701-05 / 701', formulaEn: '701-05 / 701' },
      { code: 'HSE', nameAz: 'HSE xərcləri', nameEn: 'HSE spend', formulaAz: '701-09', formulaEn: '701-09' },
    ],
  }),
};

/* ===================================================================== Agriculture */

const AGRICULTURE: TemplateDef = {
  code: 'AGRICULTURE',
  nameAz: 'Kənd təsərrüfatı',
  nameEn: 'Agriculture',
  descriptionAz: 'Bitkiçilik, heyvandarlıq və aqroemal: mövsümi xərclər, təsərrüfat sahələri, texnika, subsidiyalar.',
  descriptionEn: 'Crop farming, livestock and agro-processing: seasonal costs, farm sites, machinery, subsidies.',
  version: 1,
  accounts: chart([
    ...HEAD,
    ['601-01', '601', 'Bitkiçilik məhsullarının satışı', 'Crop sales', 'Revenue'],
    ['601-02', '601', 'Heyvandarlıq və süd məhsullarının satışı', 'Livestock and dairy sales', 'Revenue'],
    ['601-03', '601', 'Emal olunmuş məhsulların satışı', 'Processed product sales', 'Revenue'],
    ['611-01', '611', 'Dövlət subsidiyaları', 'Government subsidies', 'Revenue'],
    ['611-02', '611', 'Aqrar sığorta ödənişləri', 'Agricultural insurance compensation', 'Revenue'],
    ['701-01', '701', 'Toxum və tinglər', 'Seeds and seedlings', 'Inputs'],
    ['701-02', '701', 'Gübrələr', 'Fertilisers', 'Inputs'],
    ['701-03', '701', 'Bitki mühafizə vasitələri', 'Crop protection chemicals', 'Inputs'],
    ['701-04', '701', 'Yem', 'Animal feed', 'Inputs'],
    ['701-05', '701', 'Baytarlıq xidmətləri və dərmanlar', 'Veterinary services and medicines', 'Livestock'],
    ['701-06', '701', 'Suvarma və su xərcləri', 'Irrigation and water', 'Utilities'],
    ['701-07', '701', 'Mövsümi işçilərin əmək haqqı', 'Seasonal labour', 'Personnel'],
    ['701-08', '701', 'Daimi təsərrüfat işçilərinin əmək haqqı', 'Permanent farm labour', 'Personnel'],
    ['701-09', '701', 'Kənd təsərrüfatı texnikasının yanacağı', 'Machinery fuel', 'Machinery'],
    ['701-10', '701', 'Texnikanın təmiri', 'Machinery repair', 'Machinery'],
    ['701-11', '701', 'Torpaq icarəsi', 'Land lease', 'Land'],
    ['701-12', '701', 'Soyuducu anbar və saxlama', 'Cold storage', 'Storage'],
    ['711-01', '711', 'Məhsulun daşınması', 'Product transport', 'Logistics'],
    ['711-02', '711', 'Qablaşdırma', 'Packaging', 'Packaging'],
    ['711-03', '711', 'Satış və marketinq', 'Sales and marketing', 'Marketing'],
    ['711-04', '711', 'Sertifikatlaşdırma və laborator analizlər', 'Certification and lab tests', 'Quality'],
    ['721-01', '721', 'İnzibati heyətin əmək haqqı', 'Administrative staff salaries', 'Personnel'],
    ['721-02', '721', 'DSMF-ə məcburi sosial sığorta ayırmaları', 'Social insurance contributions (DSMF)', 'Personnel'],
    ['721-03', '721', 'Aqrar sığorta haqları', 'Agricultural insurance premiums', 'Insurance'],
    ['721-04', '721', 'Ofis və kommunal xərclər', 'Office and utilities', 'Premises'],
    ['721-05', '721', 'Proqram təminatı və İT', 'Software and IT', 'IT'],
    ['721-06', '721', 'Mühasibat və audit', 'Accounting and audit', 'Professional services'],
    ['721-07', '721', 'Hüquqi xidmətlər', 'Legal services', 'Professional services'],
    ['721-08', '721', 'Ezamiyyə xərcləri', 'Business travel', 'Travel'],
    ['721-09', '721', 'Aqronomik təlimlər', 'Agronomy training', 'Personnel'],
    ['731-01', '731', 'Məhsul və heyvan itkiləri', 'Crop and livestock losses', 'Other'],
    ['731-02', '731', 'Amortizasiya', 'Depreciation', 'Depreciation'],
    ['751-01', '751', 'Aqrar kreditlər üzrə faiz xərcləri', 'Interest on agricultural loans', 'Finance'],
    ['751-02', '751', 'Lizinq faizləri', 'Leasing interest', 'Finance'],
    ['113-01', '113', 'Traktor və kombaynlar', 'Tractors and harvesters', 'Machinery'],
    ['113-02', '113', 'Suvarma sistemləri', 'Irrigation systems', 'Infrastructure'],
    ['113-03', '113', 'İstixana və təsərrüfat tikililəri', 'Greenhouses and farm buildings', 'Buildings'],
    ['113-04', '113', 'Soyuducu anbar avadanlığı', 'Cold storage equipment', 'Storage'],
    ['113-05', '113', 'Damazlıq heyvanlar', 'Breeding livestock', 'Livestock'],
  ], COMMERCIAL_TYPES),
  content: content({
    units: [
      ...UNITS_BASE,
      { code: 'FARM', type: 'DIVISION', parent: null, nameAz: 'Təsərrüfat', nameEn: 'Farming' },
      { code: 'CROP', type: 'DEPARTMENT', parent: 'FARM', nameAz: 'Bitkiçilik', nameEn: 'Crop production' },
      { code: 'F-SMK', type: 'BRANCH', parent: 'CROP', nameAz: 'Şəmkir təsərrüfatı', nameEn: 'Shamkir farm' },
      { code: 'F-SBR', type: 'BRANCH', parent: 'CROP', nameAz: 'Sabirabad təsərrüfatı', nameEn: 'Sabirabad farm' },
      { code: 'LIV', type: 'DEPARTMENT', parent: 'FARM', nameAz: 'Heyvandarlıq', nameEn: 'Livestock' },
      { code: 'MCH', type: 'DEPARTMENT', parent: 'FARM', nameAz: 'Texnika parkı', nameEn: 'Machinery pool' },
      { code: 'PROC', type: 'DEPARTMENT', parent: null, nameAz: 'Emal və saxlama', nameEn: 'Processing and storage' },
      { code: 'COMS', type: 'DEPARTMENT', parent: null, nameAz: 'Satış və logistika', nameEn: 'Sales and logistics' },
      { code: 'ADM', type: 'DEPARTMENT', parent: null, nameAz: 'İnzibati xidmətlər', nameEn: 'Administration' },
      { code: 'HR', type: 'DEPARTMENT', parent: null, nameAz: 'İnsan resursları', nameEn: 'Human resources' },
    ],
    costCenters: [
      { code: 'FIN-01', unit: 'FIN', nameAz: 'Maliyyə', nameEn: 'Finance' },
      { code: 'CRP-SMK', unit: 'F-SMK', nameAz: 'Şəmkir — bitkiçilik', nameEn: 'Shamkir — crops' },
      { code: 'CRP-SBR', unit: 'F-SBR', nameAz: 'Sabirabad — bitkiçilik', nameEn: 'Sabirabad — crops' },
      { code: 'LIV-01', unit: 'LIV', nameAz: 'Süd fermi', nameEn: 'Dairy farm' },
      { code: 'MCH-01', unit: 'MCH', nameAz: 'Texnika parkı', nameEn: 'Machinery pool' },
      { code: 'PRC-01', unit: 'PROC', nameAz: 'Soyuducu anbar', nameEn: 'Cold storage' },
      { code: 'PRC-02', unit: 'PROC', nameAz: 'Qablaşdırma xətti', nameEn: 'Packing line' },
      { code: 'SAL-01', unit: 'COMS', nameAz: 'Satış və logistika', nameEn: 'Sales and logistics' },
      { code: 'ADM-01', unit: 'ADM', nameAz: 'İnzibati', nameEn: 'Administration' },
      { code: 'HR-01', unit: 'HR', nameAz: 'İnsan resursları', nameEn: 'Human resources' },
    ],
    kpis: [
      ...COMMON_KPIS,
      { code: 'INPUT_HA', nameAz: 'Hektara düşən giriş xərcləri', nameEn: 'Input cost per hectare', formulaAz: '(701-01 + 701-02 + 701-03) / hektar', formulaEn: '(701-01 + 701-02 + 701-03) / hectares' },
      { code: 'SUBSIDY', nameAz: 'Subsidiyaların gəlirdə payı', nameEn: 'Subsidy share of income', formulaAz: '611-01 / 6', formulaEn: '611-01 / group 6' },
    ],
  }),
};

/* ===================================================================== Services */

const SERVICES: TemplateDef = {
  code: 'SERVICES',
  nameAz: 'Xidmətlər',
  nameEn: 'Services',
  descriptionAz: 'Konsaltinq, İT xidmətləri, təlim və digər peşəkar xidmət şirkətləri: layihə heyəti, subpodratçılar, satış.',
  descriptionEn: 'Consulting, IT services, training and other professional-services firms: delivery staff, subcontractors, business development.',
  version: 1,
  accounts: chart([
    ...HEAD,
    ['601-01', '601', 'Məsləhət xidmətləri üzrə gəlir', 'Consulting fees', 'Revenue'],
    ['601-02', '601', 'Abunə və müqavilə gəlirləri', 'Subscription and retainer revenue', 'Revenue'],
    ['601-03', '601', 'Layihə gəlirləri', 'Project revenue', 'Revenue'],
    ['601-04', '601', 'Təlim xidmətləri üzrə gəlir', 'Training services revenue', 'Revenue'],
    ['601-05', '601', 'Lisenziya satışı', 'Licence resale revenue', 'Revenue'],
    ['611-01', '611', 'Sair əməliyyat gəlirləri', 'Other operating income', 'Revenue'],
    ['701-01', '701', 'Layihə heyətinin əmək haqqı', 'Delivery staff salaries', 'Personnel'],
    ['701-02', '701', 'Subpodratçılar və frilanserlər', 'Subcontractors and freelancers', 'Subcontracting'],
    ['701-03', '701', 'Layihə üzrə ezamiyyə', 'Project travel', 'Travel'],
    ['701-04', '701', 'Müştəri üçün proqram lisenziyaları', 'Third-party software for clients', 'IT'],
    ['701-05', '701', 'Bulud və hosting xidmətləri', 'Cloud and hosting', 'IT'],
    ['711-01', '711', 'Satış heyətinin əmək haqqı və bonusları', 'Sales staff salaries and bonuses', 'Personnel'],
    ['711-02', '711', 'Rəqəmsal marketinq', 'Digital marketing', 'Marketing'],
    ['711-03', '711', 'Tədbirlər və konfranslar', 'Events and conferences', 'Marketing'],
    ['711-04', '711', 'Tender və təklif xərcləri', 'Bid and proposal costs', 'Sales'],
    ['711-05', '711', 'Müştəri münasibətləri və təmsilçilik', 'Client entertainment', 'Sales'],
    ['711-06', '711', 'Partnyor komissiyaları', 'Partner commissions', 'Sales'],
    ['721-01', '721', 'İnzibati heyətin əmək haqqı', 'Administrative staff salaries', 'Personnel'],
    ['721-02', '721', 'DSMF-ə məcburi sosial sığorta ayırmaları', 'Social insurance contributions (DSMF)', 'Personnel'],
    ['721-03', '721', 'Tibbi sığorta və digər müavinətlər', 'Medical insurance and benefits', 'Personnel'],
    ['721-04', '721', 'Mükafatlar', 'Bonuses', 'Personnel'],
    ['721-05', '721', 'Təlim və peşəkar sertifikatlar', 'Training and professional certification', 'Personnel'],
    ['721-06', '721', 'İşə qəbul xərcləri', 'Recruitment costs', 'Personnel'],
    ['721-07', '721', 'Ofis icarəsi', 'Office rent', 'Premises'],
    ['721-08', '721', 'Kommunal və təmizlik xidmətləri', 'Utilities and cleaning', 'Premises'],
    ['721-09', '721', 'Daxili proqram təminatı', 'Internal software', 'IT'],
    ['721-10', '721', 'Rabitə və internet', 'Telecom and internet', 'IT'],
    ['721-11', '721', 'Audit və mühasibat xidmətləri', 'Audit and accounting services', 'Professional services'],
    ['721-12', '721', 'Hüquqi xidmətlər', 'Legal services', 'Professional services'],
    ['721-13', '721', 'Peşə məsuliyyəti sığortası', 'Professional indemnity insurance', 'Insurance'],
    ['721-14', '721', 'Ofis ləvazimatları', 'Office supplies', 'Office'],
    ['721-15', '721', 'Ümumi ezamiyyə xərcləri', 'General business travel', 'Travel'],
    ['731-01', '731', 'Amortizasiya', 'Depreciation', 'Depreciation'],
    ['731-02', '731', 'Şübhəli borclar üzrə ehtiyat', 'Provision for doubtful debts', 'Other'],
    ['751-01', '751', 'Faiz xərcləri', 'Interest expense', 'Finance'],
    ['751-02', '751', 'Məzənnə fərqi zərərləri', 'Foreign exchange losses', 'Finance'],
    ['111-01', '111', 'Proqram təminatı lisenziyaları', 'Software licences', 'IT'],
    ['113-01', '113', 'Kompüter avadanlığı', 'Computer equipment', 'IT'],
    ['113-02', '113', 'Ofis təmiri və mebel', 'Office fit-out and furniture', 'Premises'],
    ['113-03', '113', 'Nəqliyyat vasitələri', 'Vehicles', 'Fleet'],
  ], COMMERCIAL_TYPES),
  content: content({
    units: [
      ...UNITS_BASE,
      { code: 'DEL', type: 'DIVISION', parent: null, nameAz: 'Xidmətlərin göstərilməsi', nameEn: 'Service delivery' },
      { code: 'CONS', type: 'DEPARTMENT', parent: 'DEL', nameAz: 'Konsaltinq', nameEn: 'Consulting' },
      { code: 'TECH', type: 'DEPARTMENT', parent: 'DEL', nameAz: 'Texnoloji həllər', nameEn: 'Technology solutions' },
      { code: 'TRN', type: 'DEPARTMENT', parent: 'DEL', nameAz: 'Təlim mərkəzi', nameEn: 'Training centre' },
      { code: 'BD', type: 'DEPARTMENT', parent: null, nameAz: 'Biznesin inkişafı', nameEn: 'Business development' },
      { code: 'SUP', type: 'DIVISION', parent: null, nameAz: 'Dəstək funksiyaları', nameEn: 'Support functions' },
      { code: 'HR', type: 'DEPARTMENT', parent: 'SUP', nameAz: 'İnsan resursları', nameEn: 'Human resources' },
      { code: 'IT', type: 'DEPARTMENT', parent: 'SUP', nameAz: 'Daxili İT', nameEn: 'Internal IT' },
      { code: 'ADM', type: 'DEPARTMENT', parent: 'SUP', nameAz: 'Ofis və inzibati', nameEn: 'Office and administration' },
    ],
    costCenters: [
      { code: 'FIN-01', unit: 'FIN', nameAz: 'Maliyyə', nameEn: 'Finance' },
      { code: 'CNS-01', unit: 'CONS', nameAz: 'Strateji konsaltinq', nameEn: 'Strategy consulting' },
      { code: 'CNS-02', unit: 'CONS', nameAz: 'Maliyyə konsaltinqi', nameEn: 'Financial advisory' },
      { code: 'TEC-01', unit: 'TECH', nameAz: 'İmplementasiya layihələri', nameEn: 'Implementation projects' },
      { code: 'TRN-01', unit: 'TRN', nameAz: 'Təlim proqramları', nameEn: 'Training programmes' },
      { code: 'BD-01', unit: 'BD', nameAz: 'Satış və marketinq', nameEn: 'Sales and marketing' },
      { code: 'HR-01', unit: 'HR', nameAz: 'İnsan resursları', nameEn: 'Human resources' },
      { code: 'IT-01', unit: 'IT', nameAz: 'Daxili İT', nameEn: 'Internal IT' },
      { code: 'ADM-01', unit: 'ADM', nameAz: 'Ofis', nameEn: 'Office' },
    ],
    kpis: [
      ...COMMON_KPIS,
      { code: 'PEOPLE', nameAz: 'Heyət xərclərinin gəlirə nisbəti', nameEn: 'People cost to revenue', formulaAz: '(701-01 + 711-01 + 721-01…721-06) / 601', formulaEn: '(701-01 + 711-01 + 721-01…721-06) / 601' },
      { code: 'SUBC', nameAz: 'Subpodrat payı', nameEn: 'Subcontracting share', formulaAz: '701-02 / 601', formulaEn: '701-02 / 601' },
    ],
  }),
};

/* ===================================================================== Banking / Financial services */

const BANK_TYPES = {
  '4': { type: 'REVENUE' as const, cls: null },
  '5': { type: 'EXPENSE' as const, cls: 'OPEX' as const },
  '6': { type: 'EXPENSE' as const, cls: 'OPEX' as const },
  '1': { type: 'CAPEX' as const, cls: 'CAPEX' as const },
};

const BANKING: TemplateDef = {
  code: 'BANKING',
  nameAz: 'Bank və maliyyə xidmətləri',
  nameEn: 'Banking & Financial Services',
  descriptionAz: 'Banklar, BOKT və lizinq şirkətləri üçün idarəetmə (FP&A) hesablar planı: filiallar, kart biznesi, tənzimləyici xərclər, İT.',
  descriptionEn: 'Management (FP&A) chart for banks, non-bank credit organisations and leasing: branches, cards, regulatory costs, IT.',
  version: 1,
  accounts: chart([
    ['4', null, 'GƏLİRLƏR', 'INCOME'],
    ['41', '4', 'Faiz gəlirləri', 'Interest income'],
    ['41-01', '41', 'Korporativ kreditlər üzrə faiz gəlirləri', 'Interest income — corporate loans', 'Interest'],
    ['41-02', '41', 'Pərakəndə kreditlər üzrə faiz gəlirləri', 'Interest income — retail loans', 'Interest'],
    ['41-03', '41', 'Banklararası yerləşdirmələr üzrə faiz gəlirləri', 'Interest income — interbank placements', 'Interest'],
    ['41-04', '41', 'Qiymətli kağızlar üzrə faiz gəlirləri', 'Interest income — securities', 'Interest'],
    ['42', '4', 'Haqq və komissiya gəlirləri', 'Fee and commission income'],
    ['42-01', '42', 'Kart əməliyyatları üzrə komissiyalar', 'Card fees', 'Fees'],
    ['42-02', '42', 'Pul köçürmələri üzrə komissiyalar', 'Money transfer fees', 'Fees'],
    ['42-03', '42', 'Hesabların xidməti haqları', 'Account service fees', 'Fees'],
    ['42-04', '42', 'Zəmanət və akkreditivlər üzrə komissiyalar', 'Guarantee and letter of credit fees', 'Fees'],
    ['43', '4', 'Valyuta mübadiləsi gəlirləri', 'Foreign exchange income', 'Trading'],
    ['5', null, 'FAİZ XƏRCLƏRİ', 'INTEREST EXPENSE'],
    ['51-01', '5', 'Müştəri depozitləri üzrə faiz xərcləri', 'Interest expense — customer deposits', 'Interest'],
    ['51-02', '5', 'Banklararası borclar üzrə faiz xərcləri', 'Interest expense — interbank borrowings', 'Interest'],
    ['51-03', '5', 'Subordinasiya borcu üzrə faiz xərcləri', 'Interest expense — subordinated debt', 'Interest'],
    ['6', null, 'ƏMƏLİYYAT XƏRCLƏRİ', 'OPERATING EXPENSES'],
    ['61', '6', 'Heyət xərcləri', 'Personnel expenses'],
    ['61-01', '61', 'Əmək haqqı', 'Salaries', 'Personnel'],
    ['61-02', '61', 'Mükafatlar və bonuslar', 'Bonuses', 'Personnel'],
    ['61-03', '61', 'DSMF-ə məcburi sosial sığorta ayırmaları', 'Social insurance contributions (DSMF)', 'Personnel'],
    ['61-04', '61', 'Tibbi sığorta və müavinətlər', 'Medical insurance and benefits', 'Personnel'],
    ['61-05', '61', 'Təlim və sertifikatlaşdırma', 'Training and certification', 'Personnel'],
    ['62', '6', 'Bina və filial xərcləri', 'Premises and branch expenses'],
    ['62-01', '62', 'Filial və ofis icarəsi', 'Branch and office rent', 'Premises'],
    ['62-02', '62', 'Kommunal xərclər', 'Utilities', 'Premises'],
    ['62-03', '62', 'Binaların təmiri və saxlanması', 'Premises repair and maintenance', 'Premises'],
    ['62-04', '62', 'Mühafizə və inkassasiya', 'Security and cash collection', 'Security'],
    ['63', '6', 'İT xərcləri', 'IT expenses'],
    ['63-01', '63', 'Proqram lisenziyaları', 'Software licensing', 'IT'],
    ['63-02', '63', 'Core banking sisteminin dəstəyi', 'Core banking support', 'IT'],
    ['63-03', '63', 'Kart prosessinqi xərcləri', 'Card processing costs', 'IT'],
    ['63-04', '63', 'Rabitə və məlumat ötürmə kanalları', 'Telecom and data lines', 'IT'],
    ['63-05', '63', 'Kibertəhlükəsizlik', 'Cybersecurity', 'IT'],
    ['64', '6', 'Marketinq', 'Marketing'],
    ['64-01', '64', 'Reklam', 'Advertising', 'Marketing'],
    ['64-02', '64', 'Sponsorluq', 'Sponsorship', 'Marketing'],
    ['64-03', '64', 'Tədbirlər', 'Events', 'Marketing'],
    ['65', '6', 'Tənzimləyici və peşəkar xidmətlər', 'Regulatory and professional services'],
    ['65-01', '65', 'Əmanətlərin Sığortalanması Fonduna haqlar', 'Deposit insurance fund premiums', 'Regulatory'],
    ['65-02', '65', 'Tənzimləyici haqlar və hesabatlılıq', 'Regulatory fees and reporting', 'Regulatory'],
    ['65-03', '65', 'Xarici audit', 'External audit', 'Professional services'],
    ['65-04', '65', 'Hüquqi və məsləhət xidmətləri', 'Legal and advisory services', 'Professional services'],
    ['66', '6', 'Sair əməliyyat xərcləri', 'Other operating expenses'],
    ['66-01', '66', 'Ezamiyyə xərcləri', 'Business travel', 'Travel'],
    ['66-02', '66', 'Ofis ləvazimatları və çap', 'Office supplies and printing', 'Office'],
    ['66-03', '66', 'Nəqliyyat xərcləri', 'Transport', 'Fleet'],
    ['67', '6', 'Amortizasiya', 'Depreciation and amortisation', 'Depreciation'],
    ['1', null, 'KAPİTAL XƏRCLƏRİ (CAPEX)', 'CAPITAL EXPENDITURE (CAPEX)'],
    ['11-01', '1', 'Filialların açılışı və təmiri', 'Branch openings and refurbishment', 'Premises'],
    ['11-02', '1', 'Bankomat və POS terminallar', 'ATMs and POS terminals', 'Equipment'],
    ['11-03', '1', 'İT infrastrukturu (server, şəbəkə)', 'IT infrastructure (servers, network)', 'IT'],
    ['11-04', '1', 'Proqram təminatı (qeyri-maddi aktiv)', 'Software (intangible asset)', 'IT'],
    ['11-05', '1', 'Nəqliyyat vasitələri', 'Vehicles', 'Fleet'],
  ], BANK_TYPES),
  content: content({
    budgetingTypes: ['DEPARTMENT', 'BRANCH'],
    units: [
      { code: 'BOARD', type: 'EXECUTIVE', parent: null, nameAz: 'İdarə Heyəti', nameEn: 'Management Board' },
      { code: 'FIN', type: 'DEPARTMENT', parent: 'BOARD', nameAz: 'Maliyyə departamenti', nameEn: 'Finance' },
      { code: 'RISK', type: 'DEPARTMENT', parent: 'BOARD', nameAz: 'Risklərin idarə edilməsi', nameEn: 'Risk management' },
      { code: 'CMP', type: 'DEPARTMENT', parent: 'BOARD', nameAz: 'Komplayens', nameEn: 'Compliance' },
      { code: 'RTL', type: 'DIVISION', parent: null, nameAz: 'Pərakəndə bankçılıq', nameEn: 'Retail banking' },
      { code: 'RSAL', type: 'DEPARTMENT', parent: 'RTL', nameAz: 'Pərakəndə satış', nameEn: 'Retail sales' },
      { code: 'BR-01', type: 'BRANCH', parent: 'RSAL', nameAz: 'Nərimanov filialı', nameEn: 'Narimanov branch' },
      { code: 'BR-02', type: 'BRANCH', parent: 'RSAL', nameAz: 'Gəncə filialı', nameEn: 'Ganja branch' },
      { code: 'CARD', type: 'DEPARTMENT', parent: 'RTL', nameAz: 'Kart biznesi', nameEn: 'Cards' },
      { code: 'CS', type: 'DEPARTMENT', parent: 'RTL', nameAz: 'Müştəri xidmətləri', nameEn: 'Customer service' },
      { code: 'CORP', type: 'DIVISION', parent: null, nameAz: 'Korporativ bankçılıq', nameEn: 'Corporate banking' },
      { code: 'CIB', type: 'DEPARTMENT', parent: 'CORP', nameAz: 'Korporativ və investisiya bankçılığı', nameEn: 'Corporate & investment banking' },
      { code: 'INST', type: 'DEPARTMENT', parent: 'CORP', nameAz: 'İnstitusional müştərilər', nameEn: 'Institutional clients' },
      { code: 'OPS', type: 'DIVISION', parent: null, nameAz: 'Əməliyyatlar və İT', nameEn: 'Operations and IT' },
      { code: 'IT', type: 'DEPARTMENT', parent: 'OPS', nameAz: 'İnformasiya texnologiyaları', nameEn: 'Information technology' },
      { code: 'BOP', type: 'DEPARTMENT', parent: 'OPS', nameAz: 'Bek-ofis əməliyyatları', nameEn: 'Back-office operations' },
      { code: 'SEC', type: 'DEPARTMENT', parent: 'OPS', nameAz: 'Təhlükəsizlik', nameEn: 'Security' },
      { code: 'HR', type: 'DEPARTMENT', parent: null, nameAz: 'İnsan resursları', nameEn: 'Human resources' },
      { code: 'HR-REC', type: 'TEAM', parent: 'HR', nameAz: 'İşə qəbul', nameEn: 'Recruitment' },
      { code: 'HR-LND', type: 'TEAM', parent: 'HR', nameAz: 'Təlim və inkişaf', nameEn: 'Learning & development' },
      { code: 'HR-CMP', type: 'TEAM', parent: 'HR', nameAz: 'Kompensasiya', nameEn: 'Compensation' },
    ],
    costCenters: [
      { code: 'FIN-01', unit: 'FIN', nameAz: 'Maliyyə', nameEn: 'Finance' },
      { code: 'RSK-01', unit: 'RISK', nameAz: 'Risk', nameEn: 'Risk' },
      { code: 'CMP-01', unit: 'CMP', nameAz: 'Komplayens', nameEn: 'Compliance' },
      { code: 'BR01-01', unit: 'BR-01', nameAz: 'Nərimanov filialı', nameEn: 'Narimanov branch' },
      { code: 'BR02-01', unit: 'BR-02', nameAz: 'Gəncə filialı', nameEn: 'Ganja branch' },
      { code: 'CRD-01', unit: 'CARD', nameAz: 'Kart prosessinqi', nameEn: 'Card processing' },
      { code: 'CS-01', unit: 'CS', nameAz: 'Çağrı mərkəzi', nameEn: 'Contact centre' },
      { code: 'CIB-01', unit: 'CIB', nameAz: 'Korporativ bankçılıq', nameEn: 'Corporate banking' },
      { code: 'INS-01', unit: 'INST', nameAz: 'İnstitusional', nameEn: 'Institutional' },
      { code: 'IT-01', unit: 'IT', nameAz: 'Core banking', nameEn: 'Core banking' },
      { code: 'IT-02', unit: 'IT', nameAz: 'İnfrastruktur', nameEn: 'Infrastructure' },
      { code: 'BOP-01', unit: 'BOP', nameAz: 'Bek-ofis', nameEn: 'Back office' },
      { code: 'SEC-01', unit: 'SEC', nameAz: 'Fiziki təhlükəsizlik və inkassasiya', nameEn: 'Physical security and cash collection' },
      { code: 'HR-01', unit: 'HR-REC', nameAz: 'İşə qəbul', nameEn: 'Recruitment' },
      { code: 'HR-02', unit: 'HR-LND', nameAz: 'Təlim və inkişaf', nameEn: 'Learning & development' },
      { code: 'HR-03', unit: 'HR-CMP', nameAz: 'Kompensasiya', nameEn: 'Compensation' },
    ],
    kpis: [
      { code: 'CONSUMPTION', nameAz: 'Büdcənin istifadəsi', nameEn: 'Budget consumption', formulaAz: '(Fakt + Öhdəlik) / Büdcə', formulaEn: '(Actual + Committed) / Budget' },
      { code: 'CIR', nameAz: 'Xərc/gəlir nisbəti (CIR)', nameEn: 'Cost-to-income ratio', formulaAz: '6 qrupu / (4 qrupu − 5 qrupu)', formulaEn: 'Group 6 / (group 4 − group 5)' },
      { code: 'BRANCH_COST', nameAz: 'Filiala düşən xərc', nameEn: 'Cost per branch', formulaAz: 'Filial xərc mərkəzləri / filial sayı', formulaEn: 'Branch cost centers / number of branches' },
      { code: 'IT_SHARE', nameAz: 'İT xərclərinin payı', nameEn: 'IT share of OPEX', formulaAz: '63 / 6', formulaEn: '63 / 6' },
    ],
    workflows: DEFAULT_WORKFLOWS.map((w) => w.type === 'PURCHASE_REQUEST' && w.priority === 100
      ? { ...w, name: 'Satınalma sorğusu (filial və departamentlər)', steps: [{ name: 'Filial / departament rəhbəri', approverType: 'ORG_UNIT_OWNER', slaHours: 24 }, ...w.steps] }
      : w),
  }),
};

/* ===================================================================== Other */

const OTHER: TemplateDef = {
  code: 'OTHER',
  nameAz: 'Digər fəaliyyət',
  nameEn: 'Other',
  descriptionAz: 'Ümumi kommersiya şablonu: əsas gəlir və xərc hesabları, sadə struktur. İstənilən sahə üçün başlanğıc nöqtəsi.',
  descriptionEn: 'Generic commercial template: core income and expense accounts and a simple structure. A starting point for any business.',
  version: 1,
  accounts: chart([
    ...HEAD,
    ['601-01', '601', 'Əsas fəaliyyətdən gəlir', 'Revenue from core activities', 'Revenue'],
    ['611-01', '611', 'Sair əməliyyat gəlirləri', 'Other operating income', 'Revenue'],
    ['701-01', '701', 'Mal və materiallar', 'Goods and materials', 'Cost of sales'],
    ['701-02', '701', 'Kənar xidmətlər', 'Purchased services', 'Cost of sales'],
    ['711-01', '711', 'Marketinq və reklam', 'Marketing and advertising', 'Marketing'],
    ['711-02', '711', 'Logistika', 'Logistics', 'Logistics'],
    ...ADMIN,
    ['721-09', '721', 'Peşəkar xidmətlər', 'Professional services', 'Professional services'],
    ['721-10', '721', 'Ezamiyyə xərcləri', 'Business travel', 'Travel'],
    ['731-01', '731', 'Amortizasiya', 'Depreciation', 'Depreciation'],
    ['751-01', '751', 'Faiz xərcləri', 'Interest expense', 'Finance'],
    ['111-01', '111', 'Proqram təminatı', 'Software', 'IT'],
    ['113-01', '113', 'Avadanlıq', 'Equipment', 'Equipment'],
    ['113-02', '113', 'Nəqliyyat vasitələri', 'Vehicles', 'Fleet'],
  ], COMMERCIAL_TYPES),
  content: content({
    units: [
      ...UNITS_BASE,
      { code: 'OPS', type: 'DEPARTMENT', parent: null, nameAz: 'Əməliyyatlar', nameEn: 'Operations' },
      { code: 'SAL', type: 'DEPARTMENT', parent: null, nameAz: 'Satış', nameEn: 'Sales' },
      { code: 'ADM', type: 'DEPARTMENT', parent: null, nameAz: 'İnzibati', nameEn: 'Administration' },
      { code: 'HR', type: 'DEPARTMENT', parent: null, nameAz: 'İnsan resursları', nameEn: 'Human resources' },
    ],
    costCenters: [
      { code: 'FIN-01', unit: 'FIN', nameAz: 'Maliyyə', nameEn: 'Finance' },
      { code: 'OPS-01', unit: 'OPS', nameAz: 'Əməliyyatlar', nameEn: 'Operations' },
      { code: 'SAL-01', unit: 'SAL', nameAz: 'Satış', nameEn: 'Sales' },
      { code: 'ADM-01', unit: 'ADM', nameAz: 'İnzibati', nameEn: 'Administration' },
      { code: 'HR-01', unit: 'HR', nameAz: 'İnsan resursları', nameEn: 'Human resources' },
    ],
  }),
};

export const TEMPLATES: TemplateDef[] = [BANKING, SALES_DISTRIBUTION, INDUSTRY, MANUFACTURING, AGRICULTURE, SERVICES, OTHER];

/** Default organisation unit types created for every company. */
export const DEFAULT_UNIT_TYPES: {
  code: string; name: string; nameEn: string; parents: string[]; canHaveChildren: boolean; inBudgeting: boolean; sort: number;
}[] = [
  { code: 'COMPANY', name: 'Şirkət', nameEn: 'Company', parents: [], canHaveChildren: true, inBudgeting: false, sort: 0 },
  { code: 'GROUP', name: 'Qrup', nameEn: 'Group', parents: ['COMPANY'], canHaveChildren: true, inBudgeting: false, sort: 1 },
  { code: 'EXECUTIVE', name: 'İcra rəhbərliyi', nameEn: 'Executive', parents: ['COMPANY', 'GROUP'], canHaveChildren: true, inBudgeting: false, sort: 2 },
  { code: 'DIVISION', name: 'Divizion', nameEn: 'Division', parents: ['COMPANY', 'GROUP', 'EXECUTIVE', 'BUSINESS_UNIT'], canHaveChildren: true, inBudgeting: false, sort: 3 },
  { code: 'BUSINESS_UNIT', name: 'Biznes vahidi', nameEn: 'Business unit', parents: ['COMPANY', 'GROUP', 'EXECUTIVE'], canHaveChildren: true, inBudgeting: false, sort: 4 },
  { code: 'REGION', name: 'Region', nameEn: 'Region', parents: ['COMPANY', 'DIVISION', 'BUSINESS_UNIT'], canHaveChildren: true, inBudgeting: false, sort: 5 },
  { code: 'DEPARTMENT', name: 'Departament', nameEn: 'Department', parents: ['COMPANY', 'EXECUTIVE', 'DIVISION', 'BUSINESS_UNIT', 'REGION', 'BRANCH'], canHaveChildren: true, inBudgeting: true, sort: 6 },
  { code: 'BRANCH', name: 'Filial', nameEn: 'Branch', parents: ['COMPANY', 'DIVISION', 'REGION', 'DEPARTMENT', 'BUSINESS_UNIT'], canHaveChildren: true, inBudgeting: false, sort: 7 },
  { code: 'TEAM', name: 'Komanda', nameEn: 'Team', parents: ['DEPARTMENT', 'BRANCH'], canHaveChildren: false, inBudgeting: false, sort: 8 },
];
