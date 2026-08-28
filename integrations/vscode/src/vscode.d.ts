declare module 'vscode' {
  export interface Disposable {
    dispose(): unknown
  }

  export interface Uri {
    readonly fsPath: string
  }

  export interface WorkspaceFolder {
    readonly uri: Uri
    readonly name: string
  }

  export interface WorkspaceConfiguration {
    get<T>(section: string, defaultValue: T): T
  }

  export interface ExtensionContext {
    readonly subscriptions: {
      push(...items: Disposable[]): number
    }
  }

  export interface OutputChannel extends Disposable {
    append(value: string): void
    appendLine(value: string): void
    show(preserveFocus?: boolean): void
  }

  export interface QuickPickItem {
    label: string
    description?: string
    detail?: string
  }

  export interface QuickPickOptions {
    placeHolder?: string
    title?: string
  }

  export interface InputBoxOptions {
    prompt?: string
    placeHolder?: string
    ignoreFocusOut?: boolean
  }

  export const workspace: {
    readonly workspaceFolders: readonly WorkspaceFolder[] | undefined
    getConfiguration(section?: string): WorkspaceConfiguration
  }

  export const window: {
    createOutputChannel(name: string): OutputChannel
    showQuickPick<T extends QuickPickItem>(items: readonly T[], options?: QuickPickOptions): PromiseLike<T | undefined>
    showInputBox(options?: InputBoxOptions): PromiseLike<string | undefined>
    showInformationMessage(message: string): PromiseLike<string | undefined>
    showWarningMessage(message: string): PromiseLike<string | undefined>
    showErrorMessage(message: string): PromiseLike<string | undefined>
  }

  export const commands: {
    registerCommand(command: string, callback: (...args: readonly unknown[]) => unknown): Disposable
  }
}
