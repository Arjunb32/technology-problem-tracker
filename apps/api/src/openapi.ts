import spec from './openapi.json' with { type: 'json' };
import demoExtras from './openapi-demo.json' with { type: 'json' };
import schemas from '../../../packages/contracts/schemas.json' with { type: 'json' };
const inputs = {
  ProblemInput: schemas.problem,
  SolutionInput: schemas.solution,
  SolutionTestInput: schemas.test,
  VerificationInput: schemas.verify,
  StatusChangeInput: schemas.status,
  ProfileInput: schemas.profile,
  ReportInput: schemas.report,
};
export function openapi(demo: boolean) {
  const bearerAuth = {
    ...spec.components.securitySchemes.bearerAuth,
    bearerFormat: demo ? 'Local demo token' : 'Supabase access token',
  };
  return {
    ...spec,
    paths: { ...spec.paths, ...(demo ? { '/auth/demo': demoExtras.path } : {}) },
    components: {
      securitySchemes: { bearerAuth },
      schemas: {
        ...spec.components.schemas,
        ...inputs,
        ...(demo ? { DemoAuthInput: demoExtras.input } : {}),
      },
    },
  };
}
