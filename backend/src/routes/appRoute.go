package routes

import (
	"myModule/src/controllers"
	"myModule/src/sub"
	"github.com/gorilla/mux"
)

func AppRouter(r *mux.Router) {
    r.Handle("/fetchapps",  subController.AuthAndConnect(controllers.GetAllApps)).Methods("POST")
	r.Handle("/createapp", subController.AuthAndConnect(controllers.CreateApplication)).Methods("POST")
	r.Handle("/editapp", subController.AuthAndConnect(controllers.EditApplication)).Methods("POST")
}