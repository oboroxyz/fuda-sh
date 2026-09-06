export interface PrepareOptions {
  rootDir: string
  wranglerPath: string
  networkConfigPath: string
  templatePath: string
}

export function prepareRightsSubgraph(options: PrepareOptions): Promise<void>
