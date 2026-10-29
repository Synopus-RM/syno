// Syno Compliance's catalog (PRD S-15 rule 3): which areas a product touches,
// found by a plain topic screen of the idea or PRD, and the laws usually
// involved in each area and place. A starting point only: Claude checks each
// law's current text on the official site before an item can be Met (rule 5).
// skills/compliance/references/catalog.md is rendered from this list.

export const PLACES = {
  IN: "India (central)",
  "IN-TN": "Tamil Nadu",
  EU: "European Union",
  UK: "United Kingdom",
  US: "United States (federal)",
  "US-CA": "California",
  SG: "Singapore",
  AE: "United Arab Emirates",
};

// Words in an idea or PRD that put a place in scope.
const PLACE_WORDS = {
  IN: /\b(india|indian|bharat|rupees?|₹|inr|upi)\b/i,
  "IN-TN": /\b(tamil ?nadu|chennai|coimbatore|madurai|tiruchirappalli|trichy|salem|tirunelveli|tamil)\b/i,
  EU: /\b(europe|european union|eu|germany|france|spain|italy|netherlands|ireland|gdpr)\b/i,
  UK: /\b(united kingdom|uk|britain|england|london)\b/i,
  US: /\b(united states|usa|america)\b/i,
  "US-CA": /\b(california|ccpa)\b/i,
  SG: /\bsingapore\b/i,
  AE: /\b(uae|united arab emirates|dubai|abu dhabi)\b/i,
};

// The topic screen: an area applies when its words appear.
export const AREAS = {
  "personal-data": { label: "Personal data", words: /\b(personal data|phone( numbers?)?|mobile( numbers?)?|e-?mail|address|aadhaar|\bpan\b|date of birth|sign ?up|log ?in|user accounts?|profiles?|customers?' (name|details)|contacts?)\b/i },
  children: { label: "Children's data", words: /\b(child(ren)?|kids?|students? under|minors?|school|parental consent|under 18|under 13)\b/i },
  payments: { label: "Payments", words: /\b(payments?|pay online|checkout|upi|card|wallet|payment gateway|razorpay|stripe|refunds?)\b/i },
  lending: { label: "Lending and credit", words: /\b(loans?|lending|credit line|emi|interest rate|borrow(ers?)?|nbfc)\b/i },
  chits: { label: "Chit funds", words: /\bchits?( funds?)?\b/i },
  kyc: { label: "KYC and identity", words: /\b(kyc|know your customer|aadhaar|video kyc|identity check|e-?sign)\b/i },
  "sms-otp": { label: "SMS and OTP", words: /\b(otp|one[- ]time password|sms|text messages?)\b/i },
  marketing: { label: "Marketing messages", words: /\b(marketing|promotional|newsletter|campaigns?|whatsapp (broadcast|marketing)|bulk (sms|email))\b/i },
  ecommerce: { label: "E-commerce", words: /\b(e-?commerce|online (store|shop)|marketplace|sellers?|orders?|cart|listings?)\b/i },
  health: { label: "Health", words: /\b(health|medical|patients?|doctors?|clinic|prescriptions?|telemedicine|diagnos(is|tic))\b/i },
  education: { label: "Education", words: /\b(education|courses?|students?|learning|exams?|tuition|degrees?)\b/i },
  employment: { label: "Employment", words: /\b(employees?|staff|payroll|salar(y|ies)|attendance|hiring|recruit(ment|ing))\b/i },
  accessibility: { label: "Accessibility", words: /\b(website|web app|mobile app|app|portal|screen)\b/i },
  "user-content": { label: "User content", words: /\b(user[- ]generated|comments?|reviews?|posts?|uploads?|chat|forum|community)\b/i },
  ai: { label: "AI use", words: /\b(ai|artificial intelligence|machine learning|llm|chatbot|gpt|claude|model)\b/i },
  "cross-border": { label: "Data leaving the country", words: /\b(aws|azure|gcp|google cloud|firebase|vercel|supabase|servers? (abroad|outside)|cross-border|overseas)\b/i },
  "tax-invoices": { label: "Tax invoices", words: /\b(invoices?|gst|billing|tax|receipts?)\b/i },
  cookies: { label: "Cookies and tracking", words: /\b(cookies?|analytics|tracking|pixel|google analytics)\b/i },
  licences: { label: "Third-party licences", words: /\b(open source|npm|library|libraries|fonts?|icons?|third-party)\b/i },
  "app-stores": { label: "App store rules", words: /\b(play store|app store|android|ios|iphone)\b/i },
  "it-security": { label: "IT security and incidents", words: null },
};
// Areas every product in a place is checked for, whatever it does.
const ALWAYS = { IN: ["it-security"] };

const L = (area, place, law, ref, requires, source) => ({ area, place, law, ref, requires, source });
const MEITY = "https://www.meity.gov.in";
const INDIACODE = "https://www.indiacode.nic.in";
const RBI = "https://www.rbi.org.in";
const EURLEX = "https://eur-lex.europa.eu";

export const LAWS = [
  L("personal-data", "IN", "Digital Personal Data Protection Act, 2023 and DPDP Rules, 2025", "ss. 4-8, 11-13", "Notice and consent before collecting personal data; use only for the stated purpose; security safeguards; breach notice; erase when no longer needed; a way to withdraw consent and raise grievances.", MEITY),
  L("children", "IN", "Digital Personal Data Protection Act, 2023", "s. 9", "Verifiable consent of a parent or guardian for anyone under 18; no tracking, behavioural monitoring or targeted ads aimed at children.", MEITY),
  L("it-security", "IN", "Information Technology Act, 2000", "ss. 43A, 72A", "Reasonable security practices for data you hold; no disclosing personal information in breach of contract.", INDIACODE),
  L("it-security", "IN", "CERT-In Directions under s. 70B(6) of the IT Act (28 April 2022)", "Directions 2, 4, 5", "Report cyber incidents to CERT-In within 6 hours; keep ICT logs for 180 days in India; sync clocks to NTP.", "https://www.cert-in.org.in"),
  L("payments", "IN", "Payment and Settlement Systems Act, 2007 and RBI directions on payment aggregators", "RBI Master Directions", "Take payments only through an RBI-authorised payment aggregator; never store card numbers (use tokenisation).", RBI),
  L("payments", "IN", "RBI circular on storage of payment system data (6 April 2018)", "whole circular", "Payment data is stored only in India.", RBI),
  L("cross-border", "IN", "Digital Personal Data Protection Act, 2023", "s. 16", "Personal data may go abroad except to countries the government restricts; check the current list.", MEITY),
  L("lending", "IN", "RBI (Digital Lending) Directions, 2025", "whole directions", "Lend only through a regulated entity; key fact statement; loan money flows directly between borrower and lender's accounts; cooling-off period; grievance officer.", RBI),
  L("lending", "IN-TN", "Tamil Nadu Prohibition of Charging Exorbitant Interest Act, 2003", "ss. 3-4", "No interest above the rates the state allows.", "https://www.tn.gov.in"),
  L("chits", "IN", "Chit Funds Act, 1982", "ss. 4, 6-12", "Chits run only by a registered foreman, with the state's sanction, registration and security deposit.", INDIACODE),
  L("chits", "IN-TN", "Tamil Nadu Chit Funds Rules, 1984", "whole rules", "Registration with the Registrar of Chits in Tamil Nadu, and the returns and records the rules set.", "https://www.tnreginet.gov.in"),
  L("kyc", "IN", "Prevention of Money-laundering Act, 2002 and RBI Master Direction – KYC, 2016", "s. 12; MD-KYC", "Verify identity before opening an account where the law calls for KYC; keep records for 5 years.", RBI),
  L("kyc", "IN", "Aadhaar Act, 2016", "ss. 8, 29", "Aadhaar authentication only if the law allows it for you; never store or show the full Aadhaar number.", "https://uidai.gov.in"),
  L("sms-otp", "IN", "TRAI Telecom Commercial Communications Customer Preference Regulations, 2018", "Regs. 3-8 (DLT)", "Register as a sender on a DLT platform, with approved headers (sender IDs) and templates, including for OTP messages.", "https://www.trai.gov.in"),
  L("marketing", "IN", "TRAI Telecom Commercial Communications Customer Preference Regulations, 2018", "Regs. 3-8", "Promotional messages only to people who haven't opted out, through registered headers and templates.", "https://www.trai.gov.in"),
  L("marketing", "IN", "Consumer Protection Act, 2019 and Guidelines on Dark Patterns, 2023", "s. 2(28); Guidelines", "No misleading ads, fake urgency, hidden costs or other dark patterns.", "https://consumeraffairs.nic.in"),
  L("ecommerce", "IN", "Consumer Protection (E-Commerce) Rules, 2020", "Rules 4-6", "Show seller details, total price, return and refund policy; a grievance officer who answers within 48 hours.", "https://consumeraffairs.nic.in"),
  L("health", "IN", "Telemedicine Practice Guidelines, 2020", "whole guidelines", "Consultations only by registered practitioners, with the records and consent the guidelines set.", "https://www.mohfw.gov.in"),
  L("education", "IN", "UGC (Online Courses or Programmes) Regulations, 2020", "whole regulations", "Only if you award degrees or diplomas: offer them only through institutions UGC allows.", "https://www.ugc.gov.in"),
  L("employment", "IN", "The four Labour Codes (Wages 2019, Social Security 2020, Industrial Relations 2020, OSH 2020)", "whole codes", "Wages, payslips, provident fund and insurance contributions, and working conditions as the codes set.", "https://labour.gov.in"),
  L("employment", "IN-TN", "Tamil Nadu Shops and Establishments Act, 1947", "ss. 3-15", "Register the establishment; follow the working hours and leave rules.", "https://www.labour.tn.gov.in"),
  L("accessibility", "IN", "Rights of Persons with Disabilities Act, 2016", "ss. 40, 46", "Make websites and apps usable by people with disabilities; WCAG 2.1 AA is the usual technical bar.", INDIACODE),
  L("user-content", "IN", "IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, as amended", "Rules 3-4", "Terms of use, a grievance officer, and taking down unlawful content within the set times.", MEITY),
  L("ai", "IN", "MeitY advisories on AI models and synthetic content", "advisories", "Label AI-generated content and tell users when they are talking to AI; check the current advisory.", MEITY),
  L("tax-invoices", "IN", "Central Goods and Services Tax Act, 2017 and CGST Rules, 2017", "s. 31; Rule 46; e-invoicing", "Tax invoices with GSTIN, HSN or SAC, place of supply and tax split; e-invoices above the turnover threshold.", "https://cbic-gst.gov.in"),
  L("tax-invoices", "IN-TN", "Tamil Nadu Goods and Services Tax Act, 2017", "s. 31", "State GST on intra-state supplies, shown on the invoice.", "https://www.tnsgst.gov.in"),
  L("cookies", "IN", "Digital Personal Data Protection Act, 2023", "ss. 5-6", "Consent before tracking that uses personal data.", MEITY),
  L("licences", "IN", "Copyright Act, 1957 and each library's licence", "s. 51", "Follow each third-party licence: keep notices, and check copyleft terms before shipping.", INDIACODE),
  L("app-stores", "IN", "Google Play Developer Program Policies and Apple App Store Review Guidelines", "data safety; privacy labels", "A privacy policy link, accurate data-safety and privacy labels, and the stores' payment rules.", "https://play.google/developer-content-policy/"),
  L("personal-data", "EU", "General Data Protection Regulation (EU) 2016/679", "Arts. 5-7, 12-22, 32-34", "A lawful basis, clear notice, data subject rights, security and 72-hour breach notice.", EURLEX),
  L("children", "EU", "General Data Protection Regulation (EU) 2016/679", "Art. 8", "Parental consent below the member state's age (13 to 16).", EURLEX),
  L("cookies", "EU", "ePrivacy Directive 2002/58/EC", "Art. 5(3)", "Consent before non-essential cookies.", EURLEX),
  L("accessibility", "EU", "European Accessibility Act (Directive (EU) 2019/882)", "Annex I", "Accessible e-commerce and consumer apps, applying from 28 June 2025.", EURLEX),
  L("ai", "EU", "AI Act (Regulation (EU) 2024/1689)", "Arts. 5, 50", "No banned AI uses; tell people when they deal with AI or AI-made content.", EURLEX),
  L("user-content", "EU", "Digital Services Act (Regulation (EU) 2022/2065)", "Arts. 14-16", "Notice-and-action for illegal content and clear terms.", EURLEX),
  L("personal-data", "UK", "UK GDPR and Data Protection Act 2018", "Arts. 5-7, 12-22", "As GDPR, with the ICO as regulator.", "https://ico.org.uk"),
  L("children", "UK", "Age Appropriate Design Code", "15 standards", "High privacy by default for services children are likely to use.", "https://ico.org.uk"),
  L("cookies", "UK", "Privacy and Electronic Communications Regulations 2003", "Reg. 6", "Consent before non-essential cookies.", "https://ico.org.uk"),
  L("children", "US", "Children's Online Privacy Protection Act (COPPA) and Rule", "16 CFR 312", "Verifiable parental consent before collecting data from children under 13.", "https://www.ftc.gov"),
  L("marketing", "US", "CAN-SPAM Act and Telephone Consumer Protection Act", "15 USC 7704; 47 USC 227", "Honest headers and an opt-out in marketing email; consent before marketing texts and calls.", "https://www.ftc.gov"),
  L("accessibility", "US", "Americans with Disabilities Act", "Title III", "Accessible websites and apps for places of public accommodation.", "https://www.ada.gov"),
  L("personal-data", "US-CA", "California Consumer Privacy Act, as amended by the CPRA", "Cal. Civ. Code 1798.100 ff.", "Notice at collection, rights to know, delete and opt out of sale or sharing.", "https://oag.ca.gov/privacy/ccpa"),
  L("personal-data", "SG", "Personal Data Protection Act 2012", "Parts 4-6A", "Consent, purpose limits, protection and breach notice.", "https://www.pdpc.gov.sg"),
  L("personal-data", "AE", "Federal Decree-Law No. 45 of 2021 on Personal Data Protection", "Arts. 4-10", "Consent, purpose limits and data subject rights.", "https://u.ae"),
];

/** Places mentioned in `text`, with India always included (rule 2). */
export function detectPlaces(text) {
  const found = Object.keys(PLACE_WORDS).filter((p) => PLACE_WORDS[p].test(text));
  return [...new Set(["IN", ...found])];
}

/** The topic screen: the areas `text` touches, and the usual laws for them in `places`. */
export function screen(text, places) {
  const areas = Object.keys(AREAS).filter((a) => AREAS[a].words?.test(text) || places.some((p) => ALWAYS[p]?.includes(a)));
  const inScope = (law) => places.includes(law.place) || (law.place === "US" && places.includes("US-CA"));
  return { areas, laws: LAWS.filter((l) => areas.includes(l.area) && inScope(l)) };
}

/** The catalog as Markdown, for references/catalog.md. */
export function catalogMarkdown() {
  const out = ["# Syno Compliance catalog", "", "The usual laws for each area and place. A starting point, not legal advice: check each law's current text on the official site (the source link) before marking anything Met. Rendered from `scripts/lib/compliance/catalog.js`.", ""];
  for (const [area, { label }] of Object.entries(AREAS)) {
    const laws = LAWS.filter((l) => l.area === area);
    if (!laws.length) continue;
    out.push(`## ${label}`, "", "| Place | Law | Section | What it requires | Source |", "| --- | --- | --- | --- | --- |", ...laws.map((l) => `| ${PLACES[l.place]} | ${l.law} | ${l.ref} | ${l.requires} | ${l.source} |`), "");
  }
  return out.join("\n");
}
