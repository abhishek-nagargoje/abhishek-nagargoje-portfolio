// Gemini responseSchema definitions (OpenAPI-subset Schema objects used by
// generationConfig.responseSchema). The same objects are embedded into the
// validation Code nodes, so the API-side constraint and the workflow-side
// re-validation can never drift apart.

const S = (description) => ({ type: 'STRING', description });
const STATUS = { type: 'STRING', enum: ['PASS', 'FAIL', 'REVIEW_REQUIRED'] };
const CHECK = {
  type: 'OBJECT',
  properties: { Status: STATUS, Explanation: S('Specific explanation; quote problem sentences') },
  required: ['Status', 'Explanation'],
};

const PROMPT_CREATOR_SCHEMA = {
  type: 'OBJECT',
  properties: {
    Target_Page_URL: S('Exactly as given'),
    Primary_Keyword: S('Exactly as given'),
    Search_Intent: S('Given or inferred search intent'),
    Target_Audience: S('Given or inferred audience'),
    Page_Analysis: {
      type: 'OBJECT',
      properties: {
        Page_Topic: S('What the target page is about'),
        Page_Audience: S('Who the page is for'),
        Page_Search_Intent: S('Intent the page serves'),
        Keyword_Page_Fit: { type: 'STRING', enum: ['STRONG', 'PARTIAL', 'MISMATCH'] },
        Fit_Explanation: S('Why the fit rating was chosen'),
        Covered_Topics: { type: 'ARRAY', items: { type: 'STRING' } },
        Content_Gaps: { type: 'ARRAY', items: { type: 'STRING' } },
        Duplication_Risk: S('How the article could duplicate the page and how to avoid it'),
      },
      required: ['Page_Topic', 'Page_Audience', 'Page_Search_Intent', 'Keyword_Page_Fit', 'Fit_Explanation', 'Covered_Topics', 'Content_Gaps', 'Duplication_Risk'],
    },
    Article_Objective: S('Business and SEO objective'),
    Unique_Content_Angle: S('Specific useful angle'),
    Article_Outline: {
      type: 'OBJECT',
      properties: {
        H1: S('Proposed H1'),
        Sections: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              H2: S('Section heading'),
              Purpose: S('Why the section exists'),
              Key_Points: { type: 'ARRAY', items: { type: 'STRING' } },
              H3: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['H2', 'Purpose', 'Key_Points'],
          },
        },
        Recommended_Length_Words: { type: 'INTEGER' },
        Length_Rationale: S('Why this length suits the topic and intent'),
      },
      required: ['H1', 'Sections', 'Recommended_Length_Words', 'Length_Rationale'],
    },
    Approved_Brand_Facts: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { Knowledge_ID: S('Source Knowledge_ID'), Fact: S('Fact as supported') }, required: ['Knowledge_ID', 'Fact'] },
    },
    Source_Requirements: { type: 'ARRAY', items: { type: 'STRING' } },
    Forbidden_Claims: { type: 'ARRAY', items: { type: 'STRING' } },
    Internal_Link_Instructions: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { URL: S('Allowed internal URL'), Anchor_Guidance: S('Anchor text guidance'), Placement: S('Where it belongs') }, required: ['URL', 'Anchor_Guidance', 'Placement'] },
    },
    Final_Article_Writing_Prompt: S('Complete self-contained prompt for the writer'),
    Required_Output_Fields: { type: 'ARRAY', items: { type: 'STRING' } },
    Validation_Rules: { type: 'ARRAY', items: { type: 'STRING' } },
    Missing_Information: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: [
    'Target_Page_URL', 'Primary_Keyword', 'Search_Intent', 'Target_Audience', 'Page_Analysis', 'Article_Objective',
    'Unique_Content_Angle', 'Article_Outline', 'Approved_Brand_Facts', 'Source_Requirements', 'Forbidden_Claims',
    'Internal_Link_Instructions', 'Final_Article_Writing_Prompt', 'Required_Output_Fields', 'Validation_Rules',
  ],
};

const ARTICLE_PROPERTIES = {
  Article_ID: S('Echo'),
  Keyword_ID: S('Echo'),
  Target_Page_URL: S('Echo'),
  Primary_Keyword: S('Echo'),
  Supporting_Keywords: { type: 'ARRAY', items: { type: 'STRING' } },
  Article_Title: S('Reader-facing title'),
  SEO_Title: S('About 50-60 characters'),
  H1: S('On-page H1'),
  Meta_Description: S('About 140-160 characters'),
  URL_Slug: S('lowercase-hyphenated'),
  Excerpt: S('1-2 sentences'),
  Article_Markdown: S('Complete article in Markdown starting with one # H1'),
  Suggested_FAQs: {
    type: 'ARRAY',
    items: { type: 'OBJECT', properties: { Question: S('Question'), Answer: S('Answer') }, required: ['Question', 'Answer'] },
  },
  Internal_Link_Suggestions: {
    type: 'ARRAY',
    items: { type: 'OBJECT', properties: { URL: S('Allowed internal URL'), Anchor_Text: S('Anchor'), Placement: S('Section') }, required: ['URL', 'Anchor_Text', 'Placement'] },
  },
  External_Sources: {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: { Title: S('Real title'), URL: S('Real URL'), Publisher: S('Publisher'), Supports_Claim: S('Exact statement supported') },
      required: ['Title', 'URL', 'Supports_Claim'],
    },
  },
  Verified_Brand_Facts_Used: { type: 'ARRAY', items: { type: 'STRING' } },
  Word_Count: { type: 'INTEGER' },
};
const ARTICLE_REQUIRED = Object.keys(ARTICLE_PROPERTIES);

const ARTICLE_SCHEMA = { type: 'OBJECT', properties: ARTICLE_PROPERTIES, required: ARTICLE_REQUIRED };

const REVISION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ...ARTICLE_PROPERTIES,
    Corrections_Report: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { Issue: S('Failed condition'), Action: S('What changed'), Location: S('Section') }, required: ['Issue', 'Action', 'Location'] },
    },
  },
  required: [...ARTICLE_REQUIRED, 'Corrections_Report'],
};

const CHECK_NAMES = [
  'Experience_Check', 'Expertise_Check', 'Authoritativeness_Check', 'Trustworthiness_Check', 'Factual_Accuracy_Check',
  'SEO_Relevance_Check', 'Target_Page_Alignment_Check', 'Original_Value_Check', 'Readability_Check', 'Brand_Compliance_Check',
];

const EVALUATOR_SCHEMA = {
  type: 'OBJECT',
  properties: {
    Overall_Status: STATUS,
    ...Object.fromEntries(CHECK_NAMES.map((n) => [n, CHECK])),
    Failed_Conditions: { type: 'ARRAY', items: { type: 'STRING' } },
    Unsupported_Claims: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { Claim: S('Quoted claim'), Reason: S('Why unsupported'), Severity: { type: 'STRING', enum: ['CRITICAL', 'MINOR'] } },
        required: ['Claim', 'Reason', 'Severity'],
      },
    },
    Missing_Information: { type: 'ARRAY', items: { type: 'STRING' } },
    Required_Corrections: { type: 'ARRAY', items: { type: 'STRING' } },
    Reviewer_Comments: S('Overall assessment'),
  },
  required: ['Overall_Status', ...CHECK_NAMES, 'Failed_Conditions', 'Unsupported_Claims', 'Missing_Information', 'Required_Corrections', 'Reviewer_Comments'],
};

module.exports = { PROMPT_CREATOR_SCHEMA, ARTICLE_SCHEMA, REVISION_SCHEMA, EVALUATOR_SCHEMA, CHECK_NAMES };
