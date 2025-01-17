import {
  CliDefaultOptions,
  CliFs,
  CliPlugins,
  CliService,
  Command,
  CommandProvider,
  Configuration,
  createTasksRunner,
  Inject,
  ProjectPackageJson,
  QuestionOptions,
  RootRendererService,
  SrcRendererService
} from "@tsed/cli-core";
import {camelCase, paramCase} from "change-case";
import * as Listr from "listr";
import {basename, join} from "path";
import {Features, FeatureValue} from "../../services/Features";

export interface InitCmdContext extends CliDefaultOptions {
  root: string;
  srcDir: string;
  projectName: string;
  tsedVersion: string;
  features: FeatureValue[];
  featuresTypeORM?: FeatureValue;

  [key: string]: any;
}

@Command({
  name: "init",
  description: "Init a new Ts.ED project",
  args: {
    root: {
      type: String,
      defaultValue: ".",
      description: "Root directory to initialize the Ts.ED project"
    }
  },
  options: {
    "-t, --tsed-version <version>": {
      type: String,
      defaultValue: "latest",
      description: "Use a specific version of Ts.ED (format: 5.x.x)"
    }
  }
})
export class InitCmd implements CommandProvider {
  @Configuration()
  protected configuration: Configuration;

  @Inject()
  protected cliPlugins: CliPlugins;

  @Inject()
  protected packageJson: ProjectPackageJson;

  @Features()
  protected features: Features;

  @Inject()
  protected cliService: CliService;

  @Inject()
  protected srcRenderer: SrcRendererService;

  @Inject()
  protected rootRenderer: RootRendererService;

  @Inject()
  protected fs: CliFs;

  $prompt(initialOptions: Partial<InitCmdContext>): QuestionOptions {
    return [
      {
        type: "input",
        name: "projectName",
        message: "What is your project name",
        default: paramCase(initialOptions.root!),
        when: initialOptions.root !== ".",
        transformer(input) {
          return paramCase(input);
        }
      },
      ...this.features
    ];
  }

  $mapContext(ctx: Partial<InitCmdContext>): InitCmdContext {
    ctx.projectName = paramCase(ctx.projectName || basename(this.packageJson.dir));

    if (ctx.root && ctx.root !== "." && !this.packageJson.dir.endsWith(ctx.root)) {
      this.packageJson.dir = join(this.packageJson.dir, ctx.projectName);
    }

    const features: FeatureValue[] = [];

    Object.entries(ctx)
      .filter(([key]) => key.startsWith("features"))
      .forEach(([key, value]: any[]) => {
        delete ctx[key];
        features.push(...[].concat(value));
      });

    features.forEach(feature => {
      feature.type.split(":").forEach(type => {
        ctx[camelCase(type)] = true;
      });
    });

    return {
      ...ctx,
      features,
      srcDir: this.configuration.project?.srcDir
    } as InitCmdContext;
  }

  async $beforeExec(ctx: InitCmdContext) {
    this.fs.ensureDirSync(this.packageJson.dir);

    this.packageJson.name = ctx.projectName;
    this.addDependencies(ctx);
    this.addDevDependencies(ctx);
    this.addScripts();
    this.addFeatures(ctx);

    await createTasksRunner(
      [
        {
          title: "Install plugins",
          task: () => this.packageJson.install()
        },
        {
          title: "Load plugins",
          task: () => this.cliPlugins.loadPlugins()
        },
        {
          title: "Install plugins dependencies",
          task: () => {
            this.cliPlugins.addPluginsDependencies();
            return this.packageJson.install();
          }
        }
      ],
      ctx
    );
  }

  async $exec(ctx: InitCmdContext) {
    const subTasks = [
      ...(await this.cliService.getTasks("generate", {
        ...ctx,
        type: "server",
        name: "Server",
        route: "/rest"
      })),
      ...(await this.cliService.getTasks("generate", {
        type: "controller",
        route: "hello-world",
        name: "HelloWorld"
      }))
    ];

    return [
      {
        title: "Generate project files",
        task: (ctx: any) => {
          return new Listr(
            [
              {
                title: "Root files",
                task: () =>
                  this.rootRenderer.renderAll(
                    [
                      "init/.dockerignore.hbs",
                      "init/.gitignore.hbs",
                      "init/docker-compose.yml.hbs",
                      "init/Dockerfile.hbs",
                      "init/README.md.hbs",
                      "init/tsconfig.compile.json.hbs",
                      "init/tsconfig.json.hbs"
                    ],
                    ctx
                  )
              },
              {
                title: "Create index",
                task: async () => {
                  return this.srcRenderer.renderAll(["init/index.ts.hbs"], ctx);
                }
              },
              ...subTasks
            ],
            {concurrent: false}
          );
        }
      }
    ];
  }

  addScripts() {
    this.packageJson.addScripts({
      build: "yarn tsc",
      tsc: "tsc --project tsconfig.compile.json",
      "tsc:w": "tsc --project tsconfig.json -w",
      start: 'nodemon --watch "src/**/*.ts" --ignore "node_modules/**/*" --exec ts-node src/index.ts',
      "start:prod": "cross-env NODE_ENV=production node dist/index.js"
    });
  }

  addDependencies(ctx: InitCmdContext) {
    this.packageJson.addDependencies(
      {
        "@tsed/common": ctx.tsedVersion,
        "@tsed/core": ctx.tsedVersion,
        "@tsed/di": ctx.tsedVersion,
        "@tsed/ajv": ctx.tsedVersion,
        "@tsed/exceptions": ctx.tsedVersion,
        "@tsed/platform-express": ctx.tsedVersion,
        ajv: "latest",
        "body-parser": "latest",
        cors: "latest",
        compression: "latest",
        concurrently: "latest",
        "cookie-parser": "latest",
        express: "latest",
        "method-override": "latest",
        "cross-env": "latest"
      },
      ctx
    );
  }

  addDevDependencies(ctx: InitCmdContext) {
    this.packageJson.addDevDependencies(
      {
        "@types/cors": "2.8.6",
        "@types/express": "latest",
        "@types/node": "latest",
        "@types/compression": "latest",
        "@types/cookie-parser": "latest",
        "@types/method-override": "latest",
        concurrently: "latest",
        nodemon: "latest",
        "ts-node": "latest",
        typescript: "latest"
      },
      ctx
    );
  }

  addFeatures(ctx: InitCmdContext) {
    ctx.features.forEach(feature => {
      if (feature.dependencies) {
        this.packageJson.addDependencies(feature.dependencies, ctx);
      }

      if (feature.devDependencies) {
        this.packageJson.addDevDependencies(feature.devDependencies, ctx);
      }
    });
  }
}
