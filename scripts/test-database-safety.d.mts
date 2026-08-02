export const TEST_DATABASE_ACKNOWLEDGEMENT: 'I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE';

export function validateTestDatabaseEnvironment(
  env?: Readonly<Record<string, string | undefined>>,
): { testUrl: string; hostname: string };
