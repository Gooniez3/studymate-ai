import {
  resolveQuizTopic,
  extractRequestedQuestionCount,
  detectPastedReviewTarget,
} from "@/lib/ai/graph/graph";

let failures = 0;

function assert(
  label: string,
  actual: unknown,
  expected: unknown
) {
  const pass =
    actual === expected;

  if (!pass) {
    failures += 1;
  }

  console.log(
    `${pass ? "PASS" : "FAIL"} | ${label}`
  );

  if (!pass) {
    console.log(
      `  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`
    );
  }
}

function assertIncludes(
  label: string,
  haystack: string,
  needle: string
) {
  const pass =
    haystack.includes(needle);

  if (!pass) {
    failures += 1;
  }

  console.log(
    `${pass ? "PASS" : "FAIL"} | ${label}`
  );

  if (!pass) {
    console.log(
      `  Expected to include: ${JSON.stringify(needle)}\n  In: ${JSON.stringify(haystack.slice(0, 120))}`
    );
  }
}

// ============================================
// A. Revision → Quiz follow-up context
// ============================================
console.log(
  "\n=== A: REVISION → QUIZ FOLLOW-UP ==="
);

assert(
  "A1. 'quiz me on it' after revision resolves to revision topic",
  resolveQuizTopic(
    "Give me 3 quiz questions for it",
    "revision",
    { revisionTopic: "JavaScript" }
  ),
  "JavaScript"
);

assert(
  "A2. 'quiz me on this' after revision resolves to revision topic",
  resolveQuizTopic(
    "Quiz me on this",
    "revision",
    {
      revisionTopic: "React Hooks",
    }
  ),
  "React Hooks"
);

assert(
  "A3. 'what we just discussed' after revision resolves to revision topic",
  resolveQuizTopic(
    "Give me questions about what we just discussed",
    "revision",
    { revisionTopic: "Python asyncio" }
  ),
  "Python asyncio"
);

assert(
  "A4. After planner, resolves to planner topic",
  resolveQuizTopic(
    "Quiz me on it",
    "planner",
    { plannerTopic: "Data Structures" }
  ),
  "Data Structures"
);

assert(
  "A5. After assignment, resolves to assignment topic",
  resolveQuizTopic(
    "Quiz me about that",
    "assignment",
    {
      assignmentTopic: "Cloud Computing",
    }
  ),
  "Cloud Computing"
);

assert(
  "A6. No previous route keeps original message",
  resolveQuizTopic(
    "Quiz me on it",
    null,
    {}
  ),
  "Quiz me on it"
);

assert(
  "A7. Explicit topic with 'it' at end keeps original message",
  resolveQuizTopic(
    "Quiz me on JavaScript, it is hard",
    "revision",
    { revisionTopic: "Python" }
  ),
  "Quiz me on JavaScript, it is hard"
);

assert(
  "A8. 'quiz me on the same topic' after revision resolves",
  resolveQuizTopic(
    "Quiz me on the same topic",
    "revision",
    { revisionTopic: "TypeScript" }
  ),
  "TypeScript"
);

// ============================================
// B. Explicit standalone count
// ============================================
console.log(
  "\n=== B: EXPLICIT QUESTION COUNT ==="
);

assert(
  "B1. 'give me 3 quiz questions' → 3",
  extractRequestedQuestionCount(
    "give me 3 quiz questions"
  ),
  3
);

assert(
  "B2. 'make 10 questions' → 10",
  extractRequestedQuestionCount(
    "make 10 questions"
  ),
  10
);

assert(
  "B3. 'quiz me with 5 questions' → 5",
  extractRequestedQuestionCount(
    "quiz me with 5 questions"
  ),
  5
);

assert(
  "B4. 'create 7 mcqs' → 7",
  extractRequestedQuestionCount(
    "create 7 mcqs"
  ),
  7
);

assert(
  "B5. 'generate 2 quiz questions about JavaScript' → 2",
  extractRequestedQuestionCount(
    "generate 2 quiz questions about JavaScript"
  ),
  2
);

assert(
  "B6. 'write me 4 quiz questions' → 4",
  extractRequestedQuestionCount(
    "write me 4 quiz questions"
  ),
  4
);

assert(
  "B7. 'do 6 questions' → 6",
  extractRequestedQuestionCount(
    "do 6 questions"
  ),
  6
);

// ============================================
// C. Default count (no number)
// ============================================
console.log(
  "\n=== C: DEFAULT COUNT (NO NUMBER) ==="
);

assert(
  "C1. 'quiz me on JavaScript' → undefined",
  extractRequestedQuestionCount(
    "quiz me on JavaScript"
  ),
  undefined
);

assert(
  "C2. 'give me quiz questions about Python' → undefined",
  extractRequestedQuestionCount(
    "give me quiz questions about Python"
  ),
  undefined
);

assert(
  "C3. 'test me on React' → undefined",
  extractRequestedQuestionCount(
    "test me on React"
  ),
  undefined
);

assert(
  "C4. 'create a quiz about SQL' → undefined",
  extractRequestedQuestionCount(
    "create a quiz about SQL"
  ),
  undefined
);

// ============================================
// D. Document-based quiz behavior intact
// ============================================
console.log(
  "\n=== D: DOCUMENT QUIZ INTACT ==="
);

assert(
  "D1. 'quiz me on the uploaded pdf' keeps original message (no conversational ref)",
  resolveQuizTopic(
    "Quiz me on the uploaded pdf",
    "document",
    {}
  ),
  "Quiz me on the uploaded pdf"
);

assert(
  "D2. 'quiz me about page 1' keeps original message (no conversational ref)",
  resolveQuizTopic(
    "Quiz me about page 1",
    "document",
    {}
  ),
  "Quiz me about page 1"
);

assert(
  "D3. 'quiz me on Python' keeps original message (explicit topic)",
  resolveQuizTopic(
    "Quiz me on Python",
    "revision",
    { revisionTopic: "JavaScript" }
  ),
  "Quiz me on Python"
);

// ============================================
// E. Pasted review target (Assignment)
// ============================================
console.log(
  "\n=== E: PASTED REVIEW TARGET INTACT ==="
);

const pasteResult =
  detectPastedReviewTarget(
    "Review this introduction: Cloud computing has changed how companies deploy software"
  );

assert(
  "E1. Paste detected",
  pasteResult,
  true
);

// ============================================
// F. Combined: Revision → Quiz with count
// ============================================
console.log(
  "\n=== F: COMBINED TOPIC + COUNT ==="
);

assert(
  "F1. 'give me 3 quiz questions for it' after revision → topic resolved",
  resolveQuizTopic(
    "give me 3 quiz questions for it",
    "revision",
    { revisionTopic: "JavaScript" }
  ),
  "JavaScript"
);

assert(
  "F2. Count extracted from same message",
  extractRequestedQuestionCount(
    "give me 3 quiz questions for it"
  ),
  3
);

assert(
  "F3. 'quiz me with 5 questions about that' after planner → topic resolved",
  resolveQuizTopic(
    "quiz me with 5 questions about that",
    "planner",
    { plannerTopic: "Algorithms" }
  ),
  "Algorithms"
);

assert(
  "F4. Count extracted from same message",
  extractRequestedQuestionCount(
    "quiz me with 5 questions about that"
  ),
  5
);

// ============================================
// G. Two-turn integration: simulate real API
//    state flow (revision → quiz)
// ============================================
console.log(
  "\n=== G: TWO-TURN INTEGRATION ==="
);

/*
 * Simulates what the API route does on the
 * SECOND request (quiz turn). After the fix,
 * the API route no longer passes empty
 * revisionTopic/plannerTopic/assignmentTopic
 * to invoke(), so checkpointed values survive.
 *
 * This test verifies the resolveQuizTopic
 * function receives the correct state when
 * called with the same shape the real quizNode
 * receives after checkpoint restoration.
 */

type SimulatedState = {
  previousRoute:
    | "revision"
    | "planner"
    | "assignment"
    | null;
  revisionTopic: string;
  plannerTopic: string;
  assignmentTopic: string;
};

function simulateQuizTurn(
  state: SimulatedState,
  userMessage: string
) {
  const resolved = resolveQuizTopic(
    userMessage,
    state.previousRoute,
    {
      revisionTopic:
        state.revisionTopic,
      plannerTopic:
        state.plannerTopic,
      assignmentTopic:
        state.assignmentTopic,
    }
  );

  const count =
    extractRequestedQuestionCount(
      userMessage
    );

  return { resolved, count };
}

/*
 * G1. Revision → Quiz (the exact failing case)
 *
 * Turn 1: "Help me revise JavaScript for my exam."
 *   → revisionNode returns revisionTopic: "Help me revise JavaScript for my exam."
 *   → checkpointed state has revisionTopic
 *
 * Turn 2: "Give me 3 quiz questions for it."
 *   → API route (after fix) does NOT overwrite revisionTopic
 *   → quizNode receives state with revisionTopic intact
 *   → resolveQuizTopic resolves "it" → revisionTopic
 */
const g1State: SimulatedState = {
  previousRoute: "revision",
  revisionTopic:
    "Help me revise JavaScript for my exam.",
  plannerTopic: "",
  assignmentTopic: "",
};

const g1Result = simulateQuizTurn(
  g1State,
  "Give me 3 quiz questions for it"
);

assert(
  "G1. Revision → Quiz: resolvedTopic is the full revision message",
  g1Result.resolved,
  "Help me revise JavaScript for my exam."
);

assert(
  "G1. Revision → Quiz: questionCount is 3",
  g1Result.count,
  3
);

/*
 * G2. Planner → Quiz
 *
 * Turn 1: "Create a study plan for React."
 * Turn 2: "Give me 4 quiz questions about that"
 */
const g2State: SimulatedState = {
  previousRoute: "planner",
  revisionTopic: "",
  plannerTopic:
    "Create a study plan for React.",
  assignmentTopic: "",
};

const g2Result = simulateQuizTurn(
  g2State,
  "Give me 4 quiz questions about that"
);

assert(
  "G2. Planner → Quiz: resolvedTopic",
  g2Result.resolved,
  "Create a study plan for React."
);

assert(
  "G2. Planner → Quiz: questionCount is 4",
  g2Result.count,
  4
);

/*
 * G3. Assignment → Quiz
 *
 * Turn 1: "Help me structure a database normalization assignment."
 * Turn 2: "give me questions about that"
 */
const g3State: SimulatedState = {
  previousRoute: "assignment",
  revisionTopic: "",
  plannerTopic: "",
  assignmentTopic:
    "Help me structure a database normalization assignment.",
};

const g3Result = simulateQuizTurn(
  g3State,
  "give me questions about that"
);

assert(
  "G3. Assignment → Quiz: resolvedTopic",
  g3Result.resolved,
  "Help me structure a database normalization assignment."
);

assert(
  "G3. Assignment → Quiz: no explicit count (default 5)",
  g3Result.count,
  undefined
);

/*
 * G4. Explicit topic overrides previous route
 *
 * Even if previous route was revision with
 * JavaScript, "Quiz me on Python" should
 * produce Python, not JavaScript.
 */
const g4State: SimulatedState = {
  previousRoute: "revision",
  revisionTopic:
    "Help me revise JavaScript for my exam.",
  plannerTopic: "",
  assignmentTopic: "",
};

const g4Result = simulateQuizTurn(
  g4State,
  "Quiz me on Python"
);

assert(
  "G4. Explicit topic overrides previous route",
  g4Result.resolved,
  "Quiz me on Python"
);

assert(
  "G4. Count is undefined (no number)",
  g4Result.count,
  undefined
);

// ============================================
// SUMMARY
// ============================================
console.log(
  `\n=== SUMMARY: ${failures === 0 ? "ALL TESTS PASSED" : `${failures} FAILURE(S)`} ===`
);

if (failures > 0) {
  process.exitCode = 1;
}
