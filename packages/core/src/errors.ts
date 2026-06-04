export interface HarnessErrorInit {
  path: string;
  message: string;
  fix?: string;
}

export class HarnessError extends Error {
  readonly path: string;
  readonly fix?: string;

  constructor(init: HarnessErrorInit) {
    const fixSuffix = init.fix ? ` ${init.fix}` : "";
    super(`${init.path}: ${init.message}.${fixSuffix}`);
    this.name = "HarnessError";
    this.path = init.path;
    this.fix = init.fix;
  }
}
