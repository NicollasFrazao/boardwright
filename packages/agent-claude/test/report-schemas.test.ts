import { Ajv } from 'ajv';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  PLAN_REPORT_SCHEMA,
  REPORT_SCHEMA,
  REVIEW_REPORT_SCHEMA,
} from '../src/index.ts';

/**
 * The Claude Code CLI validates `--json-schema` before the session starts. A schema that declares draft
 * 2020-12 made it exit with "no schema with key or ref", the message of Ajv's default draft-07 class, so
 * every report schema must compile there.
 */
describe('the report schemas', () => {
  it.each([
    [
      'report',
      REPORT_SCHEMA,
    ],
    [
      'review report',
      REVIEW_REPORT_SCHEMA,
    ],
    [
      'plan report',
      PLAN_REPORT_SCHEMA,
    ],
  ])('compile with a draft-07 validator: %s', (
    _name,
    schema,
  ) => {
    expect(() => new Ajv().compile(schema)).not.toThrow();
  });
});
