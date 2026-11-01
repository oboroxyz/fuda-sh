export interface PrepareOptions {
  rootDir: string
  targetsPath: string
  networkConfigPath: string
  templatePath: string
}

export function prepareRightsSubgraph(options: PrepareOptions): Promise<void>
