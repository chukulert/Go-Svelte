package routes

import (
	"myModule/src/controllers"

	"github.com/gorilla/mux"
)

func GroupRouter(r *mux.Router) {
	
	// glenn
	r.HandleFunc("/fetchgroups", controllers.FetchGroups).Methods("GET")
	r.HandleFunc("/creategroup", controllers.CreateGroup).Methods("POST")
}