import { Context, defineProperty, Dict, filterKeys, HTTP, Logger, mapValues, pick, Schema, Service, Time, valueMap } from 'koishi'
import Scanner, { DependencyMetaKey, PackageJson, Registry, RemotePackage } from '@koishijs/registry'
import { dirname, join, parse, resolve } from 'path'
import { SimpleGit, simpleGit } from 'simple-git'
import { existsSync, promises as fsp, readFileSync } from 'fs'
import { compare, satisfies, valid } from 'semver'
import {} from '@koishijs/console'
import {} from '@koishijs/loader'
import getRegistry from 'get-registry'
import which from 'which-pm-runs'
import spawn from 'execa'
import pMap from 'p-map'
import {} from '.'

declare module '@koishijs/registry' {
  interface PackageJson {
    resolutions?: Dict<string>
  }
}

const logger = new Logger('market')

export interface Dependency {
  /** name */
  name: string
  /**
   * yarn protocol
   * @example `workspace`, `npm`, `git`
   */
  protocol: string
  /**
   * override package name, empty for default name
   *
   * git: url for git protocol
   */
  path?: string
  /** workspace name for monorepo, default to name */
  workspaceName?: string
  /**
   * requested semver range
   *
   * git: requested tag
   * @example `^1.2.3` -> `1.2.3`
   * @example `v1.2.3`
   */
  request: string
  /**
   * installed package version
   *
   * git: same as request
   * @example `1.2.5`
   * @example `v1.2.3`
   */
  resolved?: string
  /** whether it is a workspace package */
  workspace?: boolean
  /** valid (unsupported) syntax */
  invalid?: boolean
  /** latest version */
  latest?: string
}

export namespace Dependency {
  export const RESOLUTION_PREFIX = '▶'

  export function isResolution(name: string) {
    return name.startsWith(RESOLUTION_PREFIX)
  }

  export function asResolution(name: string) {
    return name.startsWith(RESOLUTION_PREFIX) ? name : RESOLUTION_PREFIX + name
  }

  export function asDependency(name: string) {
    return name.startsWith(RESOLUTION_PREFIX) ? name.slice(RESOLUTION_PREFIX.length) : name
  }

  export function parse(name: string, request: string): Dependency {
    const workspaceMatch = request.match(/^workspace:(.+)/)
    if (workspaceMatch) {
      return {
        name,
        protocol: 'workspace',
        request,
        invalid: true,
      }
    }

    const npmMatch = request.match(/^npm:(.+)/)
    if (npmMatch) {
      return {
        name,
        protocol: 'npm',
        path: npmMatch[1].startsWith('@') ? ('@' + npmMatch[1].split('@')[1]) : npmMatch[1].split('@')[0],
        request: npmMatch[1].split('@')[npmMatch[1].startsWith('@') ? 2 : 1]?.replace(/^[~^]/, '') ?? '',
      }
    }

    const gitMatch = request.match(/^(git[@\+].+)/)
    if (gitMatch) {
      return {
        name,
        protocol: 'git',
        path: gitMatch[1].split('#')[0],
        request: gitMatch[1].split('#')[1]?.split('&').find(item => item.startsWith('tag='))?.replace('tag=', '') || '',
        workspaceName: gitMatch[1].split('#')[1]?.split('&').find(item => item.startsWith('workspace='))?.replace('workspace=', '') || undefined,
      }
    }

    if (valid(request.replace(/^[~^]/, ''))) {
      return {
        name,
        protocol: 'npm',
        request: request.replace(/^[~^]/, ''),
      }
    }

    return {
      name,
      protocol: 'invalid',
      request,
      invalid: true,
    }
  }

  export function stringify(dep: Dependency, target: string) {
    if (!target) return ''
    switch (dep.protocol) {
      case 'workspace':
        return `workspace:${target}`
      case 'npm':
        if (dep.path) {
          return `npm:${dep.path}@${target}`
        }
        return target
      case 'git':
        return `${dep.path}#tag=${target}` + (dep.workspaceName ? `&workspace=${dep.workspaceName}` : '')
    }
  }
}

export interface YarnLog {
  type: 'warning' | 'info' | 'error' | string
  name: number | null
  displayName: string
  indent?: string
  data: string
}

const levelMap = {
  'info': 'info',
  'warning': 'debug',
  'error': 'warn',
}

export interface LocalPackage extends PackageJson {
  private?: boolean
  $workspace?: boolean
}

export function loadManifest(name: string) {
  const filename = require.resolve(name + '/package.json')
  const meta: LocalPackage = JSON.parse(readFileSync(filename, 'utf8'))
  meta.dependencies ||= {}
  defineProperty(meta, '$workspace', !filename.includes('node_modules'))
  return meta
}

function getVersions(versions: RemotePackage[]) {
  return Object.fromEntries(versions
    .map(item => [item.version, pick(item, ['peerDependencies', 'peerDependenciesMeta', 'deprecated'])] as const)
    .sort(([a], [b]) => compare(b, a)))
}

class Installer extends Service {
  public http: HTTP
  public endpoint: string
  public fullCache: Dict<Dict<Pick<RemotePackage, DependencyMetaKey>>> = {}
  public tempCache: Dict<Dict<Pick<RemotePackage, DependencyMetaKey>>> = {}

  private pkgTasks: Dict<Promise<Dict<Pick<RemotePackage, DependencyMetaKey>>>> = {}
  private agent = which()
  private manifest: PackageJson
  private depTask: Promise<Dict<Dependency>>
  private flushData: () => void
  private git: SimpleGit = simpleGit()

  constructor(public ctx: Context, public config: Installer.Config) {
    super(ctx, 'installer')
    this.manifest = loadManifest(this.cwd)
    this.flushData = ctx.throttle(() => {
      ctx.get('console')?.broadcast('market/registry', this.tempCache)
      this.tempCache = {}
    }, 500)
  }

  get cwd() {
    return this.ctx.baseDir
  }

  async start() {
    const { endpoint, timeout } = this.config
    this.endpoint = endpoint || await getRegistry()
    this.http = this.ctx.http.extend({
      endpoint: this.endpoint,
      timeout,
    })
  }

  resolveName(name: string) {
    if (name.startsWith('@koishijs/plugin-')) return [name]
    if (name.match(/(^|\/)koishi-plugin-/)) return [name]
    if (name[0] === '@') {
      const [left, right] = name.split('/')
      return [`${left}/koishi-plugin-${right}`]
    } else {
      return [`@koishijs/plugin-${name}`, `koishi-plugin-${name}`]
    }
  }

  async findVersion(names: string[]) {
    const entries = await Promise.all(names.map(async (name) => {
      try {
        const versions = Object.entries(await this.getPackage(name))
        if (!versions.length) return
        return { [name]: versions[0][0] }
      } catch (e) {}
    }))
    return entries.find(Boolean)
  }

  private async _getPackage(name: string, path: string) {
    try {
      const registry = await this.http.get<Registry>(`/${path}`)
      this.fullCache[name] = this.tempCache[name] = getVersions(Object.values(registry.versions).filter((remote) => {
        return !Scanner.isPlugin(path) || Scanner.isCompatible('4', remote)
      }))
      this.flushData()
      return this.fullCache[name]
    } catch (e) {
      logger.warn(`Cannot get package ${name} with ${path}: ${e.message}`)
      this.pkgTasks[name] = undefined
    }
  }

  private async _getGitPackage(name: string, path: string) {
    try {
      const output = await this.git.raw([
        'ls-remote',
        '--tags',
        '--sort=-version:refname', // sort by semver descending
        path.replace(/^git\+/, ''),
      ])
      const lines = output.trim().split('\n')
      const tags = []

      for (const line of lines) {
        if (!line || !line.includes('refs/tags/')) continue

        const [, ref] = line.split('\t')
        if (ref && ref.startsWith('refs/tags/') && !ref.endsWith('^{}')) {
          const tag = ref.replace('refs/tags/', '')
          tags.push(tag)
        }
      }

      const versions = Object.fromEntries(tags.map(tag => [tag, {}]))
      this.fullCache[name] = this.tempCache[name] = versions
      this.flushData()
      return this.fullCache[name]
    } catch (e) {
      logger.warn(`Cannot get git package ${name} with ${path}: ${e.message}`)
      this.pkgTasks[name] = undefined
    }
  }

  setPackage(name: string, versions: RemotePackage[]) {
    this.fullCache[name] = this.tempCache[name] = getVersions(versions)
    this.flushData()
    this.pkgTasks[name] = Promise.resolve(this.fullCache[name])
  }

  getPackage(name: string, dep?: Dependency) {
    switch (dep?.protocol) {
      case 'git':
        return this.pkgTasks[name] ||= this._getGitPackage(name, dep.path)
      default:
        return this.pkgTasks[name] ||= this._getPackage(name, dep?.path ?? dep?.name ?? name)
    }
  }

  _loadManifest2(name: string) {
    const packagePath = resolve(process.cwd(), require.resolve(name))
    if (!packagePath.startsWith(process.cwd())) throw new Error(`Package ${name} not in workspace`)
    let currentDir = dirname(packagePath)
    while (currentDir !== parse(currentDir).root) {
      const filename = join(currentDir, 'package.json')
      if (existsSync(filename)) {
        try {
          const meta: LocalPackage = JSON.parse(readFileSync(filename, 'utf8'))
          meta.dependencies ||= {}
          defineProperty(meta, '$workspace', !filename.includes('node_modules'))
          return meta
        } catch (e) {}
      }
      currentDir = dirname(currentDir)
    }
    throw new Error(`Cannot find package.json for ${name}`)
  }

  private async _getDeps(local: boolean = false) {
    const deps = valueMap(this.manifest.dependencies ?? {}, (request, name) => Dependency.parse(name, request))
    const resolutions = Object.fromEntries(Object.entries(this.manifest.resolutions ?? {})
      .map(([name, request]) => [Dependency.asResolution(name), Dependency.parse(name, request)]))
    const result = { ...deps, ...resolutions }
    await pMap(Object.entries(result), async ([name, dep]) => {
      if (dep.protocol === 'git') {
        result[name].resolved = result[name].request
      } else {
        try {
          // some dependencies may be left with no local installation
          const meta = loadManifest(dep.name)
          result[name].resolved = meta.version
          result[name].workspace = meta.$workspace
          if (meta.$workspace) return
        } catch {
          try {
            const meta = this._loadManifest2(dep.name)
            result[name].resolved = meta.version
            result[name].workspace = meta.$workspace
            if (meta.$workspace) return
          } catch (e) {
            logger.warn(`Cannot load local manifest for ${name}: ${e.message}`)
          }
        }
      }

      if (!local) {
        const versions = await this.getPackage(name, dep)
        if (versions) result[name].latest = Object.keys(versions)[0]
      }
    }, { concurrency: 10 })
    return result
  }

  getDeps() {
    return this.depTask ||= this._getDeps()
  }

  refreshData() {
    this.ctx.get('console')?.refresh('registry')
    this.ctx.get('console')?.refresh('packages')
  }

  refresh(refresh = false, purge = true) {
    if (purge) {
      this.pkgTasks = {}
      this.fullCache = {}
      this.tempCache = {}
    }
    this.depTask = this._getDeps()
    if (!refresh) return
    this.refreshData()
  }

  async exec(args: string[]) {
    const name = this.agent?.name ?? 'npm'
    const useJson = name === 'yarn' && this.agent.version >= '2'
    if (name !== 'yarn') args.unshift('install')
    return new Promise<number>((resolve) => {
      if (useJson) args.push('--json')
      const child = spawn(name, args, { cwd: this.cwd })
      child.on('exit', (code) => resolve(code))
      child.on('error', () => resolve(-1))

      let stderr = ''
      child.stderr.on('data', (data) => {
        data = stderr + data.toString()
        const lines = data.split('\n')
        stderr = lines.pop()!
        for (const line of lines) {
          logger.warn(line)
        }
      })

      let stdout = ''
      child.stdout.on('data', (data) => {
        data = stdout + data.toString()
        const lines = data.split('\n')
        stdout = lines.pop()!
        for (const line of lines) {
          if (!useJson || line[0] !== '{') {
            logger.info(line)
            continue
          }
          try {
            const { type, data } = JSON.parse(line) as YarnLog
            logger[levelMap[type] ?? 'info'](data)
          } catch (error) {
            logger.warn(line)
            logger.warn(error)
          }
        }
      })
    })
  }

  async override(deps: Dict<string>) {
    const filename = resolve(this.cwd, 'package.json')
    for (const key in deps) {
      if (Dependency.isResolution(key)) {
        const realKey = Dependency.asDependency(key)
        this.manifest.resolutions ||= {}
        if (deps[key]) {
          this.manifest.resolutions[realKey] = deps[key]
        } else {
          delete this.manifest.resolutions[realKey]
        }
      } else {
        if (deps[key]) {
          this.manifest.dependencies[key] = deps[key]
        } else {
          delete this.manifest.dependencies[key]
        }
      }
    }
    this.manifest.dependencies = Object.fromEntries(Object.entries(this.manifest.dependencies).sort((a, b) => a[0].localeCompare(b[0])))
    if (this.manifest.resolutions) {
      this.manifest.resolutions = Object.fromEntries(Object.entries(this.manifest.resolutions ?? {}).sort((a, b) => a[0].localeCompare(b[0])))
    }
    await fsp.writeFile(filename, JSON.stringify(this.manifest, null, 2) + '\n')
  }

  private _install() {
    const args: string[] = []
    if (this.config.endpoint) {
      args.push('--registry', this.endpoint)
    }
    return this.exec(args)
  }

  async install(deps: Dict<string>, forced?: boolean) {
    const localDeps = await this._getDeps(true).then((res) => filterKeys(res, (name) => Object.hasOwn(deps, name)))
    deps = mapValues(deps, (request, name) => Object.hasOwn(localDeps, name) && valid(request) ? Dependency.stringify(localDeps[name], request) : request)
    await this.override(deps)

    for (const name in deps) {
      const { resolved, workspace, protocol } = localDeps[name] || {}
      if (protocol !== 'git' && workspace || deps[name] && resolved && satisfies(resolved, deps[name], { includePrerelease: true })) continue
      forced = true
      break
    }

    if (forced) {
      const code = await this._install()
      if (code) return code
    }

    this.refresh()
    const newDeps = await this.getDeps()
    for (const key in localDeps) {
      const { name, resolved, workspace } = localDeps[key]
      if (workspace || !newDeps[key]) continue
      if (newDeps[key].resolved === resolved) continue
      try {
        if (!(require.resolve(name) in require.cache)) continue
      } catch (error) {
        if (Dependency.isResolution(key)) continue
        // FIXME https://github.com/koishijs/webui/issues/273
        // I have no idea why this happens and how to fix it.
        logger.error(error)
      }
      await this.ctx.parallel('shutdown' as any)
      this.ctx.loader.fullReload()
    }
    this.refreshData()

    return 0
  }
}

namespace Installer {
  export interface Config {
    endpoint?: string
    timeout?: number
  }

  export const Config: Schema<Config> = Schema.object({
    endpoint: Schema.string().role('link'),
    timeout: Schema.number().role('time').default(Time.second * 5),
  }) // TODO .hidden()
}

export default Installer
