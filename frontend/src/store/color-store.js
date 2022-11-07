import { writable, get } from "svelte/store"

const appplancolors = writable({
  appColors: {},
  planColors: {}
})

function GenerateColorCode() {
  var makingColorCode = "0123456789ABCDEF"
  var finalCode = "#"
  for (var counter = 0; counter < 6; counter++) {
    finalCode = finalCode + makingColorCode[Math.floor(Math.random() * 16)]
  }
  return finalCode
}

function CheckRepeat(curr) {
  let currlist = get(appplancolors)
  let plans = Object.values(currlist.planColors)
  let apps = Object.values(currlist.appColors)
  let colors = plans + "," + apps
  let colorsArr = colors.split(",")
  if (colorsArr.find(e => e == curr)) {
    return true
  } else {
    return false
  }
}

const appcolorMethods = {
  subscribe: appplancolors.subscribe,
  generateColors: GenerateColorCode(),
  addAppColors: appname => {
    appplancolors.update(items => {
      let appColors = items.appColors
      var color = GenerateColorCode()
      while (CheckRepeat(color)) {
        var color = GenerateColorCode()
      }
      appColors[appname] = color
      return { appColors, ...items }
    })
  },
  addPlanColors: planname => {
    appplancolors.update(items => {
      let planColors = items.planColors
      var color = GenerateColorCode()
      while (CheckRepeat(color)) {
        var color = GenerateColorCode()
      }
      planColors[planname] = color
      return { planColors, ...items }
    })
  }
}

export default appcolorMethods
