import { Context, Dict, I18n, Schema } from 'koishi';
declare module '@koishijs/console' {
    interface Events {
        'l10n'(data: Dict<I18n.Store>): void;
    }
}
export declare const name = "locales";
export interface Config {
    root?: string[];
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): Promise<void>;
