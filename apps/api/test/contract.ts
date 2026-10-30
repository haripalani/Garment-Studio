// Response contract checks against architecture/openapi.yaml. Every request made through the test
// client is matched to its operation; the status must be documented and the body must validate.
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;

type Op = { responses: Record<string, Record<string, unknown>> };
type Spec = { paths: Record<string, Record<string, Op>> };

const spec = parseYaml(readFileSync(new URL('../../../architecture/openapi.yaml', import.meta.url), 'utf8')) as Spec;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(spec, 'spec');

const routes = Object.keys(spec.paths).map((template) => ({
  template,
  re: new RegExp(`^/v1${template.replace(/\{[^}]+\}/g, '[^/]+')}$`),
}));

const ptr = (...parts: string[]) => parts.map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');

export const stats = { validated: 0, operations: new Set<string>() };

export function checkContract(method: string, url: string, status: number, contentType: string | null, body: unknown) {
  const path = new URL(url).pathname;
  const route = routes.find((r) => r.re.test(path));
  if (!route) throw new Error(`No OpenAPI path for ${method} ${path}`);
  const op = spec.paths[route.template]?.[method.toLowerCase()];
  if (!op) throw new Error(`No OpenAPI operation for ${method} ${route.template}`);
  let response = op.responses[String(status)];
  let base = ptr('paths', route.template, method.toLowerCase(), 'responses', String(status));
  if (!response) throw new Error(`${method} ${route.template} returned undocumented status ${status}`);
  const ref = response.$ref as string | undefined;
  if (ref) {
    base = ref.slice(2);
    response = ref
      .slice(2)
      .split('/')
      .reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, spec as unknown as Record<string, unknown>);
  }
  const content = response.content as Record<string, { schema?: unknown }> | undefined;
  stats.operations.add(`${method} ${route.template} ${status}`);
  if (!content || body === undefined) return;
  const mediaType = (contentType ?? '').split(';')[0]!.trim();
  if (!content[mediaType]) {
    throw new Error(`${method} ${route.template} ${status}: content type ${mediaType} not documented`);
  }
  if (!content[mediaType].schema) return;
  const validate = ajv.getSchema(`spec#/${base}/${ptr('content', mediaType, 'schema')}`);
  if (!validate) throw new Error(`schema not found for ${base}`);
  if (!validate(body)) {
    throw new Error(
      `${method} ${route.template} ${status} body violates the contract:\n${ajv.errorsText(validate.errors, { separator: '\n' })}\n${JSON.stringify(body).slice(0, 600)}`,
    );
  }
  stats.validated++;
}
