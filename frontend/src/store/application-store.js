import { writable } from "svelte/store"

const applications = writable([])

const applicationMethods = {
  subscribe: applications.subscribe,
  addApplication: applicationData => {
    const newApplications = {
      ...applicationData
    }
    applications.update(items => {
      return [newApplications, ...items]
    })
  }
}

export default applicationMethods
