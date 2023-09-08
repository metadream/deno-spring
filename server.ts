import { extname, resolve } from "./deps.ts";
import { HttpError, HttpStatus, Method, Mime, RouteHandler, ServerOptions } from "./types.ts";
import { Context } from "./context.ts";
import { Engine } from "./engine.ts";
import { Router } from "./router.ts";
import { Global } from "./global.ts";

/**
 * Web Application Server
 * to handle requests and static resources
 */
export class Server {
    private router = new Router();
    private engine = new Engine();

    private svrOpt: ServerOptions = {
        port: 3000,
        hostname: "0.0.0.0",
        viewRoot: "",
        imports: {},
        onListen: this.onListen.bind(this),
        onError: this.onError.bind(this),
    };

    // Run web server
    run(): Server {
        Deno.serve(this.svrOpt, this.handleRequest.bind(this));
        return this;
    }

    // Set static resources paths
    assets(...assets: string[]) {
        if (assets && assets.length) {
            for (const path of assets) {
                this.router.add({ method: Method.GET, path, handler: this.handleResource });
            }
        }
        return this;
    }

    // Set views root of template engine
    views(viewRoot: string) {
        if (viewRoot) this.svrOpt.viewRoot = viewRoot;
        return this;
    }

    // Set imports of template engine
    imports(imports: object) {
        if (imports) this.svrOpt.imports = imports;
        return this;
    }

    // Initialize app components
    // private initialize() {
    //     // Resolve decorators and routes
    //     Global.compose();
    //     Global.routes.forEach((route) => this.router.add(route));
    // }

    // Handle request
    private async handleRequest(req: Request, info: Deno.ServeHandlerInfo) {
        const ctx = new Context(req, info, this.engine);
        Object.assign(ctx, Global.plugins);
        let body = null;

        try {
            const route = this.router.find(ctx.method, ctx.path);
            if (route) {
                ctx.route = route;

                // Run middlewares
                for (const middleware of Global.middlewares) {
                    await middleware.handler(ctx);
                }
                // Run route handler
                body = await route.handler(ctx);
                if (route.template) {
                    body = await ctx.view(route.template, body);
                }
            } else {
                throw new HttpError("Route not found: " + ctx.path, HttpStatus.NOT_FOUND);
            }
        } catch (err) {
            console.error("\x1b[31m[Spring]", err, "\x1b[0m");
            ctx.status = err.status || HttpStatus.INTERNAL_SERVER_ERROR;

            if (Global.errorHandler) {
                body = await Global.errorHandler(ctx, err);
            } else {
                body = err.message || "Internal Server Error";
            }
        }
        return ctx.respond(body);
    }

    // Handle static resource
    private async handleResource(ctx: Context): Promise<ArrayBuffer | undefined> {
        // Removes the leading slash and converts relative path to absolute path
        let file = resolve(ctx.path.replace(/^\/+/, ""));

        try {
            const stat = await Deno.stat(file);
            if (stat.isDirectory) {
                file += "/index.html";
            }
            const mime = Mime[extname(file)];
            if (mime) {
                ctx.set("Content-Type", mime);
            }
            if (!stat.mtime) {
                return await Deno.readFile(file);
            }

            // Handling 304 status with negotiation cache
            // if-modified-since and Last-Modified
            const lastModified = stat.mtime.toUTCString();
            if (ctx.get("if-modified-since") === lastModified) {
                ctx.status = 304;
                ctx.statusText = "Not Modified";
            } else {
                ctx.set("Last-Modified", lastModified);
                return await Deno.readFile(file);
            }
        } catch (e) {
            if (e instanceof Deno.errors.NotFound) {
                throw new HttpError("File not found", HttpStatus.NOT_FOUND);
            } else {
                throw e;
            }
        }
    }

    // Listen event
    private onListen(params: { hostname: string; port: number }) {
        console.log(`\x1b[90m[Spring] ${this.version()}\x1b[0m`);
        console.log(`\x1b[90m[Spring] Repository: https://github.com/metadream/deno-spring\x1b[0m`);
        console.log(`[Spring] Server is running at \x1b[4m\x1b[36mhttp://${params.hostname}:${params.port}\x1b[0m`);
    }

    // Error event
    private onError(error: unknown): Response | Promise<Response> {
        console.error("\x1b[31m[Spring]", error, "\x1b[0m");
        return new Response((error as Error).message, { status: HttpStatus.INTERNAL_SERVER_ERROR });
    }

    // Format deno version object
    private version() {
        const vers = JSON.stringify(Deno.version);
        return vers ? vers.replace(/(\"|{|})/g, "").replace(/(:|,)/g, "$1 ") : "Unable to get deno version";
    }

    // Create shortcut methods
    private shortcut(method: string) {
        return (path: string, handler: RouteHandler) => {
            this.router.add({ method, path, handler });
            return this;
        };
    }

    // Create routes in shortcuts
    get(path: string, handler: RouteHandler) {
        return this.shortcut(Method.GET)(path, handler);
    }
    post(path: string, handler: RouteHandler) {
        return this.shortcut(Method.POST)(path, handler);
    }
    put(path: string, handler: RouteHandler) {
        return this.shortcut(Method.PUT)(path, handler);
    }
    delete(path: string, handler: RouteHandler) {
        return this.shortcut(Method.DELETE)(path, handler);
    }
    patch(path: string, handler: RouteHandler) {
        return this.shortcut(Method.PATCH)(path, handler);
    }
    head(path: string, handler: RouteHandler) {
        return this.shortcut(Method.HEAD)(path, handler);
    }
    options(path: string, handler: RouteHandler) {
        return this.shortcut(Method.OPTIONS)(path, handler);
    }
}
