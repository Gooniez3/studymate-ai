import { renderAssignmentMarkdown, enforceEvidenceFidelity } from "@/lib/ai/agents/assignment-assistant-agent";
import { detectPastedReviewTarget } from "@/lib/ai/graph/graph";

// Test G1 - Unicode
const unicodeGuidance = {
  title: "Cloud Computing \u2014 Study Notes",
  taskType: "report outline",
  objective: "Introduction \u2014 Define cloud computing. Student\u2019s report must cover \u201Cquoted text\u201D and deployment models \u2013 IaaS, PaaS.",
  assumptions: ["Assumed standard depth \u2013 not exam specific"],
  draftStrengths: [],
  commonMistakes: ["Confusing IaaS with PaaS"],
  improvementSuggestions: ["Benefits & Challenges \u2013 Analyze cloud adoption drivers."],
  nextActions: ["Draft the Introduction section first."],
  requirements: [{ requirement: "Introduction \u2014 Define cloud computing.", importance: "required" as const }],
  suggestedStructure: [{ section: "Introduction", purpose: "Define scope", suggestedPoints: ["Definitions & models"] }],
  taskBreakdown: [{ step: 1, title: "Research", description: "Gather sources" }],
  rubricFocus: [],
};

const rendered = renderAssignmentMarkdown(unicodeGuidance as any);
console.log("G1 Unicode test:");
console.log("  Preserved em dash:", rendered.includes("\u2014"));
console.log("  Preserved curly apostrophe:", rendered.includes("\u2019"));
console.log("  Preserved curly quotes:", rendered.includes("\u201C") && rendered.includes("\u201D"));
console.log("  Preserved en dash:", rendered.includes("\u2013"));
console.log("  No mojibake:", !/[\uFFFD]/.test(rendered));
console.log("---");

// Test G2 - User-provided constraints survive
const request1500 = "Help me structure a 1500-word report about cloud computing.";
const guidance = {
  title: "Cloud Computing Report Structure",
  taskType: "report structure",
  objective: "Outline a focused report covering service models and adoption trade-offs within your stated length.",
  assumptions: [],
  draftStrengths: [],
  commonMistakes: [],
  improvementSuggestions: ["Include a Harvard reference list for credibility."],
  nextActions: ["Plan sections around the 1500-word limit."],
  requirements: [{ requirement: "1500-word report length as specified by you.", importance: "required" as const }],
  suggestedStructure: [{ section: "Introduction", purpose: "Scope the report.", suggestedPoints: [] }],
  taskBreakdown: [],
  rubricFocus: [],
};

const result = enforceEvidenceFidelity(guidance as any, "", request1500);
console.log("G2 User-provided 1500-word test:");
const wordCountPreserved = JSON.stringify(result).includes("1500-word") && !JSON.stringify(result).includes("[length requirement unverified]");
console.log("  Word count preserved:", wordCountPreserved);
const harvardMasked = !result.improvementSuggestions.some((item: string) => /\bharvard\b/i.test(item));
console.log("  Invented Harvard masked:", harvardMasked);
console.log("---");

// Test G3 - Speech as brief
const speechContext = "Valedictorian speech for the class of 2026 thanking teachers and parents. Success is measured by kindness and curiosity.";
const speechRequest = "Help me structure this assignment using the uploaded brief.";
const speechGuidance = {
  title: "Structure Suggestion",
  taskType: "structure guidance",
  objective: "General structure suggestion.",
  assumptions: [],
  draftStrengths: [],
  commonMistakes: [],
  improvementSuggestions: [],
  nextActions: [],
  requirements: [
    { requirement: "Use Harvard referencing.", importance: "required" as const },
    { requirement: "Around 2000 words long.", importance: "required" as const },
  ],
  suggestedStructure: [],
  taskBreakdown: [],
  rubricFocus: [{ criterion: "Analysis depth", whatItMeans: "40% of marks.", howToAddress: "Evaluate deeply." }],
};

const speechResult = enforceEvidenceFidelity(speechGuidance as any, speechContext, speechRequest);
console.log("G3 Speech-as-brief test:");
console.log("  Fabricated requirements removed:", speechResult.requirements.length === 0);
console.log("  Rubric cleared:", speechResult.rubricFocus.length === 0);
const mismatchPresent = speechResult.assumptions.some((a: string) => /does not appear to contain assignment brief/i.test(a));
console.log("  Mismatch note present:", mismatchPresent);
console.log("---");

// Test G4 - detectPastedReviewTarget
const cases: [string, string, boolean][] = [
  ["short inline paste", "Review this introduction: Cloud computing has changed education.", true],
  ["explicit rubric + paste", "Review this introduction using the uploaded rubric: Cloud computing has changed education.", true],
  ["long paste", "Check this paragraph: " + "Cloud adoption continues to accelerate across industries. ".repeat(6), true],
  ["newline paste", "Give feedback on this draft:\n\nCloud platforms reduce operational overhead.", true],
  ["legit doc ref, no paste", "Review this using the uploaded rubric.", false],
  ["legit doc ref 2", "Compare this draft with the assignment brief.", false],
  ["ordinary conversation", "Make it shorter.", false],
  ["plain explanation ask", "Explain this to me.", false],
];
console.log("G4 detectPastedReviewTarget:");
let matrixPassed = true;
for (const [label, message, expected] of cases) {
  const actual = detectPastedReviewTarget(message);
  const passed = actual === expected;
  if (!passed) matrixPassed = false;
  console.log(`  ${label}: expected=${expected}, actual=${actual} ${passed ? "PASS" : "FAIL"}`);
}
console.log("  Matrix passed:", matrixPassed);
console.log("---");

// Test Bug 1 - Invented "required" criteria
console.log("Bug 1 test - Invented required criteria:");
const bug1Guidance = {
  title: "Introduction Review",
  taskType: "draft review",
  objective: "Review the provided introduction.",
  assumptions: [],
  draftStrengths: ["Clear topic statement"],
  commonMistakes: [],
  improvementSuggestions: ["Add more context"],
  nextActions: ["Revise introduction"],
  requirements: [
    { requirement: "Identify at least two strengths (required)", importance: "required" as const },
    { requirement: "Point out three specific weaknesses (required)", importance: "required" as const },
    { requirement: "Provide concrete suggestions for improvement (required)", importance: "required" as const },
  ],
  suggestedStructure: [],
  taskBreakdown: [],
  rubricFocus: [],
};

const bug1Result = enforceEvidenceFidelity(bug1Guidance as any, "", "Review this introduction: Cloud computing has changed how companies deploy software.");
console.log("  Requirements after fidelity:", bug1Result.requirements.map(r => `${r.requirement} [${r.importance}]`));
const hasInventedRequired = bug1Result.requirements.some(r => r.importance === "required" && /at least two|three specific|concrete suggestions/i.test(r.requirement));
console.log("  Invented required criteria remain:", hasInventedRequired);
console.log("---");

// Test Bug 2 - Internal fidelity markers leak to UI
console.log("Bug 2 test - Internal markers in rendered markdown:");
const bug2Guidance = {
  title: "Review",
  taskType: "draft review",
  objective: "The assignment expects a brief written review (≈[length requirement unverified]).",
  assumptions: ["[citation style unverified]"],
  draftStrengths: [],
  commonMistakes: [],
  improvementSuggestions: ["Fix the [deadline unverified] issue"],
  nextActions: [],
  requirements: [],
  suggestedStructure: [],
  taskBreakdown: [],
  rubricFocus: [],
};

const bug2Rendered = renderAssignmentMarkdown(bug2Guidance as any);
console.log("  Rendered markdown:");
console.log(bug2Rendered);
const hasMarkers = /\[length requirement unverified\]|\[citation style unverified\]|\[deadline unverified\]|\[weighting unverified\]|\[referencing style unverified\]|\[percentage unverified\]|≈\[/.test(bug2Rendered);
console.log("  Contains internal markers:", hasMarkers);
console.log("---");

// Test Bug 3 - Speculative assumptions
console.log("Bug 3 test - Speculative assumptions:");
const bug3Guidance = {
  title: "Introduction Review",
  taskType: "draft review",
  objective: "Review the provided introduction.",
  assumptions: [
    "The student will submit the revised introduction after incorporating feedback.",
    "The lecturer expects academic tone.",
    "Target audience is university professors.",
  ],
  draftStrengths: ["Clear topic statement"],
  commonMistakes: [],
  improvementSuggestions: ["Add more context"],
  nextActions: ["Revise introduction"],
  requirements: [],
  suggestedStructure: [],
  taskBreakdown: [],
  rubricFocus: [],
};

const bug3Result = enforceEvidenceFidelity(bug3Guidance as any, "", "Review this introduction: Cloud computing has changed how companies deploy software.");
console.log("  Assumptions after fidelity:", bug3Result.assumptions);
const hasSpeculative = bug3Result.assumptions.some(a => /will submit|lecturer expects|target audience/i.test(a));
console.log("  Speculative assumptions remain:", hasSpeculative);
console.log("---");

// Test Intent-sensitive rendering - draft review should not show Requirements/Structure/Rubric
console.log("Intent-sensitive rendering test (draft review):");
const draftReviewGuidance = {
  title: "Introduction Review",
  taskType: "draft review",
  objective: "Feedback on your introduction.",
  assumptions: [],
  draftStrengths: ["Clear opening statement", "Identifies the topic"],
  commonMistakes: ["Too vague", "No thesis statement"],
  improvementSuggestions: ["Add a clear thesis", "Provide context for why this matters"],
  nextActions: ["Revise introduction with thesis", "Add specific examples"],
  requirements: [],
  suggestedStructure: [],
  taskBreakdown: [],
  rubricFocus: [],
};

const draftRendered = renderAssignmentMarkdown(draftReviewGuidance as any);
console.log("  Rendered draft review:");
console.log(draftRendered);
console.log("  Has Requirements section:", draftRendered.includes("### Requirements"));
console.log("  Has Suggested Structure section:", draftRendered.includes("### Suggested Structure"));
console.log("  Has Task Breakdown section:", draftRendered.includes("### Task Breakdown"));
console.log("  Has Rubric Focus section:", draftRendered.includes("### Rubric Focus"));
console.log("  Has Draft Strengths section:", draftRendered.includes("### Draft Strengths"));
console.log("  Has Improvements section:", draftRendered.includes("### Improvements"));
console.log("  Has Next Steps section:", draftRendered.includes("### Next Steps"));
console.log("---");

// Test Intent-sensitive rendering - structure help SHOULD show Requirements/Structure
console.log("Intent-sensitive rendering test (structure help):");
const structureGuidance = {
  title: "Cloud Computing Report Structure",
  taskType: "report structure",
  objective: "Structure a 1500-word report about cloud computing.",
  assumptions: [],
  draftStrengths: [],
  commonMistakes: [],
  improvementSuggestions: [],
  nextActions: ["Plan sections around the 1500-word limit"],
  requirements: [{ requirement: "1500-word report length", importance: "required" as const }],
  suggestedStructure: [
    { section: "Introduction", purpose: "Scope the report", suggestedPoints: ["Define cloud computing", "State thesis"] },
    { section: "Body", purpose: "Analyze service models", suggestedPoints: ["IaaS", "PaaS", "SaaS"] },
    { section: "Conclusion", purpose: "Summarize findings", suggestedPoints: ["Key takeaways"] },
  ],
  taskBreakdown: [
    { step: 1, title: "Research", description: "Gather sources on cloud service models" },
    { step: 2, title: "Outline", description: "Create detailed outline" },
  ],
  rubricFocus: [],
};

const structureRendered = renderAssignmentMarkdown(structureGuidance as any);
console.log("  Rendered structure help:");
console.log(structureRendered);
console.log("  Has Requirements section:", structureRendered.includes("### Requirements"));
console.log("  Has Suggested Structure section:", structureRendered.includes("### Suggested Structure"));
console.log("  Has Task Breakdown section:", structureRendered.includes("### Task Breakdown"));
console.log("---");

// Test Bug 1B - Explicit user requirement preserved
console.log("Bug 1B test - Explicit user requirement preserved:");
const bug1bGuidance = {
  title: "Introduction Review",
  taskType: "draft review",
  objective: "Review the provided introduction.",
  assumptions: [],
  draftStrengths: ["Clear topic statement"],
  commonMistakes: [],
  improvementSuggestions: ["Add more context"],
  nextActions: ["Revise introduction"],
  requirements: [
    { requirement: "Identify exactly 2 strengths", importance: "required" as const },
  ],
  suggestedStructure: [],
  taskBreakdown: [],
  rubricFocus: [],
};

const bug1bResult = enforceEvidenceFidelity(bug1bGuidance as any, "", "Review this introduction and identify exactly 2 strengths.");
const bug1bPreserved = bug1bResult.requirements.some(r => r.importance === "required" && /exactly 2 strengths/i.test(r.requirement));
console.log("  Explicit 2-strength requirement preserved:", bug1bPreserved);
console.log("---");

// Test Bug 1C - Rubric-grounded requirement preserved
console.log("Bug 1C test - Rubric-grounded requirement preserved:");
const bug1cGuidance = {
  title: "Assignment Analysis",
  taskType: "rubric analysis",
  objective: "Analyze the assignment against the rubric.",
  assumptions: [],
  draftStrengths: [],
  commonMistakes: [],
  improvementSuggestions: [],
  nextActions: [],
  requirements: [
    { requirement: "Identify three weaknesses", importance: "required" as const },
  ],
  suggestedStructure: [],
  taskBreakdown: [],
  rubricFocus: [],
};

const bug1cResult = enforceEvidenceFidelity(bug1cGuidance as any, "Rubric: Students must identify three weaknesses.", "What does this rubric require?");
const bug1cPreserved = bug1cResult.requirements.some(r => r.importance === "required" && /three weaknesses/i.test(r.requirement));
console.log("  Rubric-grounded requirement preserved:", bug1cPreserved);
console.log("---");

// Test Bug E - Final rendered markdown contains no internal fidelity markers
console.log("Bug E test - No internal fidelity markers in rendered markdown:");
const bugEGuidance = {
  title: "Report Review",
  taskType: "draft review",
  objective: "Review the report. The assignment expects [length requirement unverified] and [citation style unverified] referencing. The deadline is [deadline unverified].",
  assumptions: ["[weighting unverified] grading applies."],
  draftStrengths: ["Good structure"],
  commonMistakes: [],
  improvementSuggestions: ["Fix [deadline unverified] section"],
  nextActions: [],
  requirements: [],
  suggestedStructure: [],
  taskBreakdown: [],
  rubricFocus: [],
};

const bugERendered = renderAssignmentMarkdown(bugEGuidance as any);
const markerPatterns = [
  /\[length requirement unverified\]/i,
  /\[citation style unverified\]/i,
  /\[deadline unverified\]/i,
  /\[weighting unverified\]/i,
  /\[percentage unverified\]/i,
  /\[referencing style unverified\]/i,
  /≈\[/,
  /\bunverified\b/,
];
const foundMarkers = markerPatterns.filter(p => p.test(bugERendered));
const bugEPassed = foundMarkers.length === 0;
console.log("  Rendered markdown:");
console.log(bugERendered);
console.log("  Markers found:", foundMarkers.length === 0 ? "none" : foundMarkers.map(p => p.source).join(", "));
console.log("  No internal markers:", bugEPassed);
console.log("---");