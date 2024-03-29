// deno-lint-ignore-file no-explicit-any
import { resolve } from "./deps.ts";
import { Renderer } from "./types.ts";

// Template syntax
const syntax = {
    PARTIAL: /\{\{@\s*(\S+?)\s*\}\}/g,
    BLOCK_HOLDER: /\{\{>\s*(\S+?)\s*\}\}/g,
    BLOCK_DEFINE: /\{\{<\s*(\S+?)\s*\}\}([\s\S]*?)\{\{<\s*\}\}/g,
    EVALUATE: /\{\{([\s\S]+?(\}?)+)\}\}/g,
    INTERPOLATE: /\{\{=([\s\S]+?)\}\}/g,
    CONDITIONAL: /\{\{\?(\?)?\s*([\s\S]*?)\s*\}\}/g,
    ITERATIVE: /\{\{~\s*(?:\}\}|([\s\S]+?)\s*\:\s*([\w$]+)\s*(?:\:\s*([\w$]+))?\s*\}\})/g,
};

// Variable patterns
const variable = {
    REMOVE: /\/\*[\w\W]*?\*\/|\/\/[^\n]*\n|\/\/[^\n]*$|"(?:[^"\\]|\\[\w\W])*"|'(?:[^'\\]|\\[\w\W])*'|\s*\.\s*[$\w\.]+/g,
    SPLIT: /[^\w$]+/g,
    KEYWORDS:
        /\b(abstract|arguments|async|await|boolean|break|byte|case|catch|char|class|const|continue|debugger|default|delete|do|double|else|enum|eval|export|extends|false|final|finally|float|for|function|goto|if|implements|import|in|instanceof|int|interface|let|long|native|new|null|of|package|private|protected|public|return|short|static|super|switch|synchronized|then|this|throw|throws|transient|true|try|typeof|undefined|var|void|volatile|while|with|yield|parseInt|parseFloat|decodeURI|decodeURIComponent|encodeURI|encodeURIComponent|isFinite|isNaN|Array|ArrayBuffer|Object|Function|Math|Date|Boolean|String|RegExp|Map|Set|JSON|Promise|Reflect|Number|BigInt|Infinity|Error|NaN)\b/g,
    NUMBER: /^\d[^,]*|,\d[^,]*/g,
    BOUNDARY: /^,+|,+$/g,
    SPLIT2: /^$|,+/,
};

/**
 * A compact, high-performance and full-featured template engine
 * @Author metadream
 * @Since 2022-11-09
 */
export class Engine {
    // Cache template file and compiled function
    private cache: Record<string, Renderer> = {};

    // Template engine options
    private tmplRoot = "";
    private attributes: Record<string, any> = {};

    // Set the root of template files
    init(tmplRoot: string): void {
        this.tmplRoot = tmplRoot;
    }

    // Import attributes to template
    import(attributes: Record<string, unknown>): void {
        Object.assign(this.attributes, attributes);
    }

    /**
     * Compile the template to a function
     * @param {string} tmpl
     * @returns {Function} Anonymous function for rendering data
     */
    compile(tmpl: string): Renderer {
        const codes: string[] = [];
        tmpl = this.block(tmpl);
        tmpl = this.escape(this.reduce(tmpl))
            .replace(syntax.INTERPOLATE, (_: string, code: string) => {
                code = this.unescape(code);
                codes.push(code);
                return "'+(" + code + ")+'";
            })
            .replace(syntax.CONDITIONAL, (_: string, elseCase: string, code: string) => {
                if (!code) return this.output(elseCase ? "}else{" : "}");
                code = this.unescape(code);
                codes.push(code);
                return this.output(elseCase ? "}else if(" + code + "){" : "if(" + code + "){");
            })
            .replace(syntax.ITERATIVE, (_: string, arrName: string, valName: string, idxName: string) => {
                if (!arrName) return this.output("}}");
                codes.push(arrName);
                const defI = idxName ? "let " + idxName + "=-1;" : "";
                const incI = idxName ? idxName + "++;" : "";
                return this.output(
                    "if(" + arrName + "){" + defI + "for (let " + valName + " of " + arrName + "){" + incI + "",
                );
            })
            .replace(syntax.EVALUATE, (_: string, code: string) => {
                code = this.unescape(code);
                codes.push(code);
                return this.output(code + ";");
            });

        let source = "let out='" + tmpl + "';return out;";
        source = this.declare(codes) + source;

        try {
            const fn = new Function("data", source);
            return async (data: unknown) => {
                const attributes = await this.export();
                data = Object.assign({ ...attributes }, data);
                return fn.call(null, data);
            };
        } catch (e) {
            e.source = "function anonymous(data) {" + source + "}";
            throw e;
        }
    }

    // Render the template text with data
    render(tmpl: string, data: unknown): Promise<string> {
        return this.compile(tmpl)(data);
    }

    // Render the template file with cache
    async view(file: string, data: unknown): Promise<string> {
        let render = this.cache[file];
        if (!render) {
            render = this.cache[file] = this.compile(await this.include(file));
        }
        return render(data);
    }

    // Load template file recursively
    private async include(file: string): Promise<string> {
        let tmpl = await Deno.readTextFile(resolve(this.tmplRoot, file));
        while (syntax.PARTIAL.test(tmpl)) {
            tmpl = await this.replaceAsync(tmpl, syntax.PARTIAL, async (_: string, _file: string) => {
                return await Deno.readTextFile(resolve(this.tmplRoot, _file));
            });
        }
        return tmpl;
    }

    // Replace block holders with block defines
    private block(tmpl: string): string {
        const blocks: Record<string, string> = {};
        return tmpl
            .replace(syntax.BLOCK_DEFINE, (_, name: string, block) => {
                blocks[name] = block;
                return "";
            })
            .replace(syntax.BLOCK_HOLDER, (_, name: string) => blocks[name] || "");
    }

    // Parse variables as declares in function body header
    private declare(codes: string[]): string {
        const varNames = codes.join(",")
            .replace(variable.REMOVE, "")
            .replace(variable.SPLIT, ",")
            .replace(variable.KEYWORDS, "")
            .replace(variable.NUMBER, "")
            .replace(variable.BOUNDARY, "")
            .split(variable.SPLIT2);

        const unique: Record<string, boolean> = {};
        const prefixVars = [];
        for (const name of varNames) {
            if (!unique[name]) {
                unique[name] = true;
                prefixVars.push(name);
            }
        }
        if (prefixVars.length) {
            const varString = prefixVars.map((v) => v + "=data." + v).join(",");
            return "let " + varString + ";";
        }
        return "";
    }

    // Execute the values of attributes in runtime.
    private async export(): Promise<Record<string, unknown>> {
        const attributes: Record<string, unknown> = {};
        for (const [name, fn] of Object.entries(this.attributes)) {
            attributes[name] = await fn();
        }
        return attributes;
    }

    // Reduce template text
    private reduce(tmpl: string): string {
        return tmpl.trim()
            .replace(/<!--[\s\S]*?-->/g, "") // remove html comments
            .replace(/\/\*[\s\S]*?\*\//g, "") // remove js comments in multiline
            .replace(/\n\s*\/\/.*/g, "") // remove js comments inline
            .replace(/(\r|\n)[\t ]+/g, "") // remove leading spaces
            .replace(/[\t ]+(\r|\n)/g, "") // remove trailing spaces
            .replace(/\r|\n|\t/g, ""); // remove breaks and tabs
    }

    // Escape backslash and single quotes
    private escape(tmpl: string): string {
        return tmpl.replace(/\\/g, "\\\\").replace(/\'/g, "\\'");
    }

    // Unescape single quotes
    private unescape(tmpl: string): string {
        return tmpl.replace(/\\'/g, "'");
    }

    // Shortcut of ouput
    private output(code: string): string {
        return "';" + code + "out+='";
    }

    // Override replacement function
    private async replaceAsync(str: string, regex: RegExp, asyncFn: any) {
        const promises: any = [];
        const replacer: any = (match: any, ...args: any) => {
            const promise = asyncFn(match, ...args);
            promises.push(promise);
        };
        str.replace(regex, replacer);
        const data = await Promise.all(promises);
        return str.replace(regex, () => data.shift());
    }
}
