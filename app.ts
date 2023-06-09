import { Callback, Decorator, HttpError, Middleware, Route } from "./defs.ts";
import { Reflect } from "./deps.ts";

/**
 * Spring Runtime Cache
 * Caching instances of decorator constructors
 */
export class App {

    // All the global instances at runtime
    static plugins: Record<string, unknown> = {};
    static middlewares: Middleware[] = [];
    static routes: Route[] = [];
    static errorHandler?: Callback;

    // To avoid creating instance repeatedly, use "Set" to automatically deduplicate.
    // deno-lint-ignore no-explicit-any
    private static constructors: Set<any> = new Set();

    /**
     * Append target constructor (called when the decorator is triggered)
     * @param constructor
     * @param decorator
     */
    // deno-lint-ignore no-explicit-any
    static append(constructor: any, decorator: Decorator) {
        this.constructors.add(constructor);

        // There may be more than one class decorator on single class
        if (decorator.type === "class") {
            const decorators: Decorator[] = Reflect.getMetadata("class:decorators", constructor) || [];
            decorators.push(decorator);
            Reflect.defineMetadata("class:decorators", decorators, constructor);
        } else {
            // There may be also more than one method decorator on single method,
            // so defines method decorators group by method name (which is "fn" in this case)
            const fn = decorator.fn as string;
            const decoratorGroup: Record<string, Decorator[]>
                = Reflect.getMetadata("method:decorators", constructor) || {};
            const decorators: Decorator[] = decoratorGroup[fn] || [];

            decorators.push(decorator);
            decoratorGroup[fn] = decorators;
            Reflect.defineMetadata("method:decorators", decoratorGroup, constructor);
        }
    }

    /**
     * Resolve all decorators
     */
    static compose() {
        // Get and create instances from each constructor
        for (const c of this.constructors) {
            // New an instance
            const instance = new c();

            // Parse class decorators
            const classDecorators: Decorator[] = Reflect.getMetadata("class:decorators", c) || [];
            let controller: Decorator | undefined;

            for (const decorator of classDecorators) {
                // Parse plugin decorators (singleton binding, independent of specific methods)
                if (decorator.name === "Plugin" && decorator.value) {
                    this.plugins[decorator.value] = instance;
                    continue;
                }

                // Set a temporary controller for later use
                if (decorator.name === "Controller") {
                    controller = decorator;
                }
            }

            // Parse method decorators
            const g: Record<string, Decorator[]> = Reflect.getMetadata("method:decorators", c) || {};
            const group = Object.values(g);

            for (const decorators of group) for (const decorator of decorators) {
                if (!decorator.fn) continue;
                const callback = instance[decorator.fn].bind(instance);

                // Parse error handler
                if (decorator.name === "ErrorHandler") {
                    if (this.errorHandler) {
                        throw new HttpError("Duplicated error handler");
                    }
                    this.errorHandler = callback;
                    continue;
                }

                // Parse middleware handlers
                if (decorator.name === "Middleware") {
                    const priority = decorator.value as number;
                    this.middlewares.push({ callback, priority });
                    continue;
                }

                // Ignore template decorator (but will be used later)
                if (decorator.name === "View") {
                    continue;
                }

                // Parse routes such as GET, POST, PUT...
                if (!controller) {
                    throw new HttpError("The class of route must be annotated with @Controller");
                }

                // Find template decorator in the same method scope
                const tmpl: Decorator | undefined = decorators.find(v => v.name === "View");
                const template = tmpl ? tmpl.value as string : undefined;
                const prefix = controller.value as string || "";
                const path = decorator.value as string || "";

                this.routes.push({
                    method: decorator.name,
                    path: ("/" + prefix + path).replace(/[\/]+/g, "/"),
                    callback, template
                });
            }
        }

        // Sort middlewares by priority
        this.middlewares.sort((a, b) => a.priority - b.priority);
    }

}