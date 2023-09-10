// deno-lint-ignore-file no-explicit-any
import { Reflect } from "./deps.ts";
import { Decorator, Route, RouteHandler } from "./types.ts";
import { Server } from "./server.ts";

export const container = new class Container {
    errorHandler?: RouteHandler;
    interceptors: RouteHandler[] = [];
    routes: Route[] = [];

    private singletons: Set<any> = new Set();
    private server = new Server();

    // Register decorators
    register(target: any, decorator: Decorator) {
        if (decorator.name === ":Bootstrap") {
            target.instance = target.instance || new target(this.server);
            this.server.run();
        } else {
            if (decorator.type === "class") {
                target.instance = target.instance || new target();
            }
            this.defineMetadata(target, decorator);
            this.singletons.add(target);
        }
    }

    // Inject modules
    inject(target: any) {
        const found = this.singletons.has(target);
        if (!found) throw "The module '" + target.name + "' may not be registered.";

        const interceptor = this.getMetadata(target, "class:Interceptor")[0];
        const component = this.getMetadata(target, "class:Component")[0];
        const controller = this.getMetadata(target, "class:Controller")[0];
        const errorHandler = this.getMetadata(target, "method:ErrorHandler")[0];
        const requests = this.getMetadata(target, "method:Request");
        const views = this.getMetadata(target, "method:View");
        const properties = this.getMetadata(target, "property:Autowired");

        // Extract all methods of the interceptor
        if (interceptor) {
            const members = Object.getOwnPropertyNames(target.prototype);
            for (const member of members) {
                if (member !== "constructor") {
                    this.interceptors.push(target.instance[member]);
                }
            }
            return;
        }

        if (errorHandler) {
            if (!component) throw "The module of '" + target.name + "' must be decorated.";
            if (!errorHandler.relname) throw "@ErrorHandler decorator must be added to a method.";
            this.errorHandler = target.instance[errorHandler.relname].bind(target.instance);
        }

        // Inject member properties
        for (const prop of properties) {
            if (!component && !controller) throw "The module of '" + target.name + "' must be decorated.";
            if (!prop.relname) throw "@Autowired decorator must be added to a property.";

            const relname = prop.relname as string;
            const _component: any = this.findComponent(relname);
            if (!_component) throw "Undefined component '" + relname + "' in '" + target.name + "'.";

            target.instance[relname] = _component.instance;
            this.server.module[relname] = _component.instance;
        }

        // Parse request routes
        for (const req of requests) {
            if (!controller) throw "The module '" + target.name + "' must be decorated with @Controller.";
            if (!req.relname) throw "Request decorators must be added to a method.";
            if (!req.value) throw "Request decorator must have a value.";

            const handler = target.instance[req.relname].bind(target.instance);
            const path = ("/" + controller.param + req.param).replace(/[\/]+/g, "/");
            const view = views.find((v) => v.relname === req.relname);
            const template = view ? view.param : undefined;
            this.routes.push({ method: req.value, path, handler, template });
        }
    }

    private findComponent(alias: string) {
        for (const singleton of this.singletons) {
            const decorator = this.getMetadata(singleton, "class:Component")[0];
            if (decorator && decorator.param === alias) return singleton;
        }
    }

    private defineMetadata(target: any, decorator: Decorator): void {
        const key = decorator.type + decorator.name;
        const decorators: Decorator[] = Reflect.getMetadata(key, target) || [];
        decorators.push(decorator);
        Reflect.defineMetadata(key, decorators, target);
    }

    private getMetadata(target: any, key: string): Decorator[] {
        return Reflect.getMetadata(key, target) || [];
    }
}();
