export interface SubmissionSummary {
  id: string;
  lookupCode: string;
  createdAt: string;
  schemaVersion: string;
  ageBand: string | null;
  sexAtBirth: string | null;
}

export interface SectionResponse {
  id: string;
  question: string;
  answerLabel: string;
  rawValue: unknown;
}

export interface Section {
  id: string;
  title: string;
  responses: SectionResponse[];
}

export interface FullSubmission extends SubmissionSummary {
  zipCode: string | null;
  markdown: string;
  sections: Section[];
}
