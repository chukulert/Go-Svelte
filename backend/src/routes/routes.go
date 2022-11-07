package routes

import "github.com/gorilla/mux"

func NewRouter() *mux.Router {
	r := mux.NewRouter()
	UserRouter(r)
	GroupRouter(r)
	AppRouter(r)
	PlanRouter(r)
	TaskRouter(r)
	return r

}