# FinBridge — Product research (FP&A and the Azerbaijani market)

Purpose: decide which capabilities FinBridge adopts, and when. Research done in October 2026 from vendor
documentation, analyst/review sites and Azerbaijani regulatory/accounting sources (URLs below each section).
Priorities use MoSCoW: **Must** (Phases 1–4, built now), **Should** (next), **Could** (opportunistic), **Later** (Phase 5+).

## 1. What the market leaders have in common

| Product | Relevant features | Why it matters for FinBridge |
|---------|-------------------|------------------------------|
| **Workday Adaptive Planning** | Plan collection with multi-approver workflows (submit → accept / send back), version control, ERP/CRM actuals | Budget collection from department leads and sign-off is the core FinBridge process |
| **Anaplan** | Connected planning across finance/ops, multidimensional models, what-if scenarios (aggressive / conservative) | Shared data model across modules; scenarios later |
| **Planful** | Budget templates (HR, CAPEX, OPEX, initiatives) pushed to budget managers as tasks, approve / send back, audit trail, rollback to prior version | Template-driven onboarding, task inbox for budget owners, versions |
| **Vena** | Excel-native UI with workflows, approvals and controls; scenarios; full audit trail of inputs | Excel remains the bridge for our market; governance on top |
| **Pigment** | Driver-based models, scenarios, real-time dashboards, comments, granular access rights | Dashboards and access control expectations |
| **NetSuite Planning & Budgeting** | Revenue / expense / workforce / capital planning modules, rolling forecasts, multi-scenario, workflows + "who changed what, when and why" | CAPEX vs OPEX separation, change traceability |
| **SAP Analytics Cloud (planning)** | Version management (public/private), data locking, validation rules, allocations | Locking approved data and versions as first-class objects |
| **Board** | Unified BI + planning, dashboards, connectors | Reporting and planning on one model |
| **Prophix** | Template distribution, workflow tracking (bottlenecks, reminders), personnel planning, currency conversion | SLA / reminder / escalation; currency conversion |
| **OneStream** | Unified consolidation + planning + reporting, workflow automation, multi-entity | Multi-company and consolidation later |
| **Datarails** | Excel-native, version control, collection workflows with sign-off tracking, consolidation from Excel files | Validates "Excel as entry point" positioning for SMEs |
| **ERP budgetary control** (Oracle Budgetary Control, PeopleSoft Commitment Control, Infor LN) | Funds check at requisition, PO and invoice; pre-encumbrance → encumbrance → expenditure | Model for Purchase Request budget check and "committed" amounts |

Sources:
[Workday Adaptive — advanced workflows](https://doc.workday.com/adaptive-planning/en-us/workday-adaptive-planning-documentation/hubs-and-workflows/advanced-workflows/steps--set-up-advanced-workflows.html) ·
[Workday customer story](https://workday.com/en-us/customer-stories/a-h/commerce-bank-enterprise-wide-planning-all-in-one.html) ·
[Anaplan planning & budgeting datasheet](https://www.anaplan.com/content/dam/anaplan/assets/documents/datasheet/anaplan-planning-and-budgeting-for-public-sector-datasheet.pdf) ·
[Planful budget manager experience](https://planful.com/budget-manager-experience/) ·
[Planful review (The CFO Club)](https://thecfoclub.com/tools/planful-review-pros-cons-features-pricing/) ·
[Vena budgeting & forecasting](https://www.venasolutions.com/solutions/budgeting-forecasting) ·
[Pigment (BARC)](https://barc.com/review/pigment/) ·
[NetSuite Planning and Budgeting docs](https://docs.oracle.com/en/cloud/saas/netsuite-planning-budgeting/use.html) ·
[SAP Analytics Cloud planning features](https://learning.sap.com/courses/exploring-sap-analytics-cloud/describing-planning-features_c4054dc5-c8af-4c7b-8f74-54d03b0bc413) ·
[Board (Capterra)](https://www.capterra.co.uk/software/73473/board) ·
[Prophix budgeting & planning](https://www.prophix.com/au/use-case/budgeting-planning) ·
[OneStream (BARC)](https://barc.com/?p=103697) ·
[Datarails FP&A](https://www.datarails.com/fpa-software/) ·
[Oracle Budgetary Control](https://www.cleverence.com/articles/oracle-documentation/control-budgets-4827/) ·
[PeopleSoft commitment control](https://docs.oracle.com/cd/G35227_01/fscm92pbr54/eng/fscm/spog/UnderstandingCommitmentControlinPeopleSoftPurchasing-9f39dc.html) ·
[Infor LN purchase budget control](https://docs.infor.com/ln/2024.x/en-us/lnolh/tfbgcug/tdom000022.html)

## 2. Azerbaijani market and accounting practice

- **Accounting systems in use:** localized **1C** (1C:Accounting 8 for Azerbaijan, 1C:Company Management, via partners such as Feniks-MNR),
  local ERPs **SOFTECH** and **COMPLEX.AZ** (e-VHF, ASAN İmza, DSMF integrations), plus SAP, Dynamics 365, Odoo, NetSuite in larger groups.
  These systems keep the books; none of the local players positions itself as an FP&A / budget-control layer — this is FinBridge's gap.
  FinBridge must therefore **import actuals from them** (Excel today, API later) rather than replace them.
- **Chart of accounts:** commercial organisations use the national chart of accounts (Ministry of Finance; NAS based on IFRS). Income/expense
  synthetic accounts used in budgeting: **601** Satış, **611** Sair əməliyyat gəlirləri, **701** Satışın maya dəyəri, **711** Kommersiya xərcləri,
  **721** İnzibati xərclər, **731** Sair əməliyyat xərcləri, **751** Maliyyə xərcləri; CAPEX on **111** Qeyri-maddi aktivlər and
  **113** Torpaq, tikili və avadanlıqlar. FinBridge templates therefore use these synthetic accounts as groups with management sub-accounts
  (e.g. 721-01 Salaries). **Banks** use a separate CBAR chart (Decision No. 32, 2012), so the banking template uses its own management structure.
- **Reporting framework:** public-interest entities and banks report under full IFRS; other commercial companies under NAS based on IFRS.
  Groups with subsidiaries must consolidate → multi-company consolidation is a real later need.
- **Currency:** AZN is the functional currency for local companies, but USD/EUR purchases are common → PR in foreign currency with conversion is a Must.

Sources:
[Feniks-MNR 1C products](https://feniks.az/en/1c-products/) ·
[SOFTECH](https://softech.az/en) ·
[Best ERP for Baku 2026 (SUN Corporation)](https://suncorporation.az/en/blog/best-erp-baku-2026.html) ·
[ERP consulting companies in Azerbaijan](https://techbehemoths.com/companies/erp-consulting/azerbaijan) ·
[Account 601 Satış](https://e-muhasib.az/hesablar.php?n=601) ·
[Account 701 Satışın maya dəyəri](https://www.e-muhasib.az/hesablar.php?n=701) ·
[Yeni hesablar planı (Partner Group)](https://partnergroupmmc.az/yenihesablarplani/) ·
[CBAR chart of accounts for the banking system, Decision No. 32](https://www.cbar.az/law-193/decision-no-32) ·
[CBAR accounting regulations for credit institutions](https://www.cbar.az/law-53/regulations-on-maintaining-accounting-in-credit-institutions-of-the-republic-of-azerbaijan) ·
[IAS Plus — Azerbaijan](https://www.iasplus.com/en/jurisdictions/asia/azerbaijan)

## 3. Feature decisions

| Feature | Seen in | Why it matters | Adopt? | Priority |
|---------|---------|----------------|--------|----------|
| Configurable organisation hierarchy (any unit types) | Anaplan, Adaptive, OneStream | Azerbaijani companies range from flat SMEs to banks with branches/divisions | Yes | **Must** |
| Cost centers as first-class objects with owner / responsible | All ERPs, Adaptive | Accountability for budget and spend | Yes | **Must** |
| Hierarchical chart of accounts, OPEX/CAPEX | NetSuite, SAP, Planful | Roll-ups, CAPEX planning, local NAS chart | Yes | **Must** |
| Industry templates (accounts + structure + workflows + KPIs) | Planful templates, OneStream Solution Exchange | Fast onboarding, our differentiator for local SMEs | Yes | **Must** |
| Monthly budget lines by cost center × account | All | Core planning grain | Yes | **Must** |
| Versions + locking; never overwrite approved data | SAP SAC, Planful, NetSuite | Governance, auditability | Yes | **Must** |
| Configurable multi-step approval workflows, conditional routing, dynamic approvers | Adaptive, Prophix, NetSuite | No-code process configuration; differs per company | Yes | **Must** |
| Budget change requests on locked budgets | SAP (locking), ERP budget control | Controlled changes without losing the original | Yes | **Must** |
| Purchase / expense requests with funds check, commitments | Oracle BC, PeopleSoft, Infor | Turns a budget into real spending control | Yes | **Must** |
| Plan vs Actual vs Committed, variance, drill-down dashboards | All | The value moment for CFOs | Yes | **Must** |
| Excel import with mapping, preview, validation, history; Excel export everywhere | Vena, Datarails | Market is Excel-first | Yes | **Must** |
| Full audit trail (who / what / when / old / new / why) | NetSuite, Vena, Planful | Financial governance | Yes | **Must** |
| SLA, reminders, escalation, delegation | Prophix, Adaptive | Approvals stall without them | Yes (in-app; e-mail later) | **Must** (in-app) / **Should** (e-mail) |
| Multi-currency (base, transaction, rate) | Prophix, NetSuite | USD/EUR purchases | Yes, basic | **Must** (PR conversion) |
| Scenarios (base / best / worst), rolling forecasts | Anaplan, Pigment, NetSuite | CFO planning, but secondary to control | Data model ready | **Should** |
| Workforce / headcount planning | Planful, Prophix, Pigment | Personnel is the largest cost | No (accounts only) | **Later** |
| Driver-based modelling, formulas | Anaplan, Pigment | Powerful but complex to sell/implement | No | **Later** |
| Excel add-in (live Excel grid) | Vena, Datarails, NetSuite Smart View | Familiarity | No — upload/download first | **Could** |
| 1C / SOFTECH / COMPLEX.AZ connectors for actuals | Prophix/Datarails connectors | Removes manual actual uploads | Planned | **Should** |
| Consolidation / multi-entity groups | OneStream, Board | Groups must consolidate under IFRS | Data model ready (company tenant) | **Later** |
| AI forecasting / variance explanations | Vena Copilot, Datarails AI, NetSuite | Differentiator, needs data history first | No | **Later** |
| Private sandbox versions | SAP SAC | Nice for analysts | No | **Later** |

## 4. What FinBridge deliberately does not build yet

Driver-based modelling engines, workforce planning, consolidation, AI features, live Excel add-ins and ERP connectors.
They depend on a stable structure → budget → workflow → spend → actual foundation, which is what Phases 1–4 deliver.
