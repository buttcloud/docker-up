const assert = require('assert')
const Url = require('url')
const { defaultTo, isNil, map, tap } = require('ramda')
const { isBoolean, isString } = require('ramda-adjunct')
const Future = require('fluture')

module.exports = GenericResource

function GenericResource (options) {
  const { name: resourceName, hasUpdate, idField, listField } = options

  assert(
    isString(resourceName),
    `docker-up/resources/generic.js: required string 'name', given: ${resourceName}`
  )
  assert(
    isBoolean(hasUpdate),
    `docker-up/resources/generic.js: required boolean 'hasUpdate', given: ${hasUpdate}`
  )
  assert(
    isString(idField),
    `docker-up/resources/generic.js: required string 'idField', given: ${idField}`
  )
  assert(
    isNil(listField) || isString(listField),
    `docker-up/resources/generic.js: optional string 'listField', given: ${listField}`
  )

  return function Resource (context) {
    const { docker, log } = context

    return {
      name: resourceName,
      create,
      down,
      inspect,
      list,
      up,
      // TODO implement update using remove and create
      update: hasUpdate ? update : () => Future.of(null),
      remove
    }

    function up (config) {
      return inspect(config)
        .chainRej(err => {
          return err.status === 404 ? Future.of(null) : Future.reject(err)
        })
        .chain(value => {
          if (isNil(value)) {
            return create(config)
          }

          if (hasUpdate) {
            const { Version: { Index: version } } = value
            return update(config, { version })
          }

          return Future.of(null)
        })
        .chain(() => inspect(config))
    }

    function down (config) {
      return inspect(config)
        .chain(() => remove(config))
        .chainRej(err => {
          return err.status === 404 ? Future.of(null) : Future.reject(err)
        })
    }

    function create (config) {
      var { Name: name } = config

      log.info(`Creating ${resourceName}: ${name}`, {
        action: `${resourceName}:create:before`,
        config
      })

      return docker
        .post(`/${resourceName}s/create`, {
          json: config
        })
        .bimap(
          tap(err => log.error(`Error creating ${resourceName}: ${name}`, err)),
          tap(response => {
            if (response.warning) {
              log.warn(response.Warning, {
                action: `${resourceName}:create`,
                config
              })
            }
            log.info(`${resourceName} created: ${name}`, {
              action: `${resourceName}:create`,
              config,
              response
            })
          })
        )
        .map(getId)
    }

    function inspect (config) {
      const { Name: name } = config

      const id = isNil(name) ? getId(config) : name

      log.info(`Inspecting ${resourceName}: ${id}`, {
        action: `${resourceName}:inspect:before`,
        config
      })

      return docker
        .get(`/${resourceName}s/${id}`, {
          json: true
        })
        .bimap(
          tap(err => log.error(`Error inspecting ${resourceName}: ${id}`, err)),
          tap(response => {
            log.info(`Inspected ${resourceName}: ${id}`, {
              action: `${resourceName}:inspect:after`,
              config,
              response
            })
          })
        )
    }

    function list () {
      log.info(`Listing ${resourceName}:`, {
        action: `${resourceName}:list:before`
      })

      return docker
        .get(`/${resourceName}s`, {
          json: true
        })
        .bimap(
          tap(err => log.error(err, `Error listing ${resourceName}`)),
          tap(response => {
            log.info({
              action: `${resourceName}:list:after`,
              message: `Listed ${resourceName}`,
              response
            })
          })
        )
        .map(response => {
          return isNil(listField) ? response : response[listField]
        })
        .map(defaultTo([]))
        .chain(resources => {
          const eachResource = map(inspect)
          return Future.parallel(8, eachResource(resources))
        })
    }

    function update (config) {
      const { Name: name } = config

      return inspect(config)
        .chain(current => {
          const params = {
            version: current.Version.Index
          }
          const url = Url.format({
            pathname: `/${resourceName}s/${name}/update`,
            query: params
          })
          log.info(`Updating ${resourceName}: ${name}`, {
            action: `${resourceName}:update:before`,
            config,
            params
          })
          return docker.post(url, {
            json: config
          })
        })
        .bimap(
          tap(err => log.error(err, `Error updating ${resourceName}: ${name}`)),
          tap(response => {
            log.info({
              action: `${resourceName}:update:after`,
              message: `Updated ${resourceName}: ${name}`,
              config,
              response
            })
          })
        )
    }

    function remove (config) {
      var { Name: name } = config

      log.info(`Removing ${resourceName}: ${name}`, {
        action: `${resourceName}:remove:before`,
        config
      })

      return docker
        .delete(`/${resourceName}s/${name}`)
        .bimap(
          tap(err => log.error(err, `Error removing ${resourceName}: ${name}`)),
          () => {
            log.info({
              action: `${resourceName}:remove:after`,
              config,
              message: `Removed ${resourceName}: ${name}`
            })
            return null
          }
        )
    }

    function getId (value) {
      return value[idField]
    }
  }
}
