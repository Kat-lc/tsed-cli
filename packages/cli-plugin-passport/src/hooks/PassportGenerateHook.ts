import {IGenerateCmdContext, ProvidersInfoService} from "@tsed/cli";
import {Inject, OnExec, OnPrompt, ProjectPackageJson, QuestionOptions, SrcRendererService, Tasks} from "@tsed/cli-core";
import {Injectable} from "@tsed/di";
import {paramCase} from "change-case";
import {PassportClient} from "../services/PassportClient";
import {TEMPLATE_DIR} from "../utils/templateDir";

export interface IPassportGenerationOptions extends IGenerateCmdContext {
  passportPackage: string;
}

@Injectable()
export class PassportGenerateHook {
  @Inject()
  projectPackageJson: ProjectPackageJson;

  @Inject()
  srcRenderService: SrcRendererService;

  @Inject()
  passportClient: PassportClient;

  packages: any[];

  constructor(private providersInfoService: ProvidersInfoService) {
    providersInfoService.add(
      {
        name: "Protocol",
        value: "protocol"
      },
      PassportGenerateHook
    );
  }

  @OnPrompt("generate")
  async onGeneratePrompt(initialOption: IGenerateCmdContext): Promise<QuestionOptions> {
    this.packages = await this.passportClient.getPackages();

    const list = this.packages.map(item => {
      return {
        name: `${item.name} - ${item.description}`,
        value: item.name
      };
    });

    return [
      {
        type: "autocomplete",
        name: "passportPackage",
        message: "Which passport package ?",
        when(state: any) {
          return ["protocol"].includes(state.type);
        },
        source: async (state: any, keyword: string) => {
          if (keyword) {
            return list.filter(item => item.name.toLowerCase().includes(keyword.toLowerCase()));
          }

          return list;
        }
      }
    ];
  }

  @OnExec("generate")
  onGenerateExec(ctx: IPassportGenerationOptions): Tasks {
    if (this.providersInfoService.isMyProvider(ctx.type, PassportGenerateHook)) {
      const {symbolPath, ...data} = this.mapOptions(ctx);
      const {passportPackage} = ctx;

      this.projectPackageJson.addDependency(ctx.passportPackage, this.getPassportPackageVersion(passportPackage));

      return [
        {
          title: `Generate ${ctx.type} file to '${symbolPath}.ts'`,
          task: () =>
            this.srcRenderService.render(this.getTemplate(passportPackage), data, {
              output: `${symbolPath}.ts`,
              templateDir: TEMPLATE_DIR
            })
        }
      ];
    }

    return [];
  }

  private mapOptions(options: IPassportGenerationOptions) {
    return {
      ...options,
      protocolName: paramCase(options.name),
      passportPackage: options.passportPackage
    };
  }

  private getTemplate(passportPackage: string) {
    const template = `${passportPackage}.protocol.hbs`;

    return this.srcRenderService.templateExists(template, {templateDir: TEMPLATE_DIR}) ? template : "generic.protocol.hbs";
  }

  private getPassportPackageVersion(passportPackage: string) {
    const passportPkgDetails = this.packages.find(pkg => pkg.name === passportPackage);

    return passportPkgDetails ? passportPkgDetails["dist-tags"]?.latest : undefined;
  }
}
