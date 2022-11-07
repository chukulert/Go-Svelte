package routes

import (
	"myModule/src/controllers"
	subController "myModule/src/sub"

	"github.com/gorilla/mux"
)

func TaskRouter(r *mux.Router) {
	r.Handle("/changestate", subController.AuthAndConnect(controllers.StateTransition)).Methods("POST")
	r.Handle("/createtask", subController.AuthAndConnect(controllers.CreateTask)).Methods("POST")
	r.Handle("/getalltask", subController.AuthAndConnect(controllers.FetchAllTask)).Methods("POST")
	r.Handle("/getalltaskbyacronym", subController.AuthAndConnect(controllers.FetchAllTaskByAcronym)).Methods("POST")
	r.Handle("/getalltaskbyacronymnplan", subController.AuthAndConnect(controllers.FetchAllTaskByAcronymNPlan)).Methods("POST")
	r.Handle("/edittask", subController.AuthAndConnect(controllers.EditTask)).Methods("POST")
	r.Handle("/inserttasknote", subController.AuthAndConnect(controllers.InsertTaskNote)).Methods("POST")
	r.Handle("/email", subController.AuthAndConnect(controllers.Triggermail)).Methods("POST")
}
